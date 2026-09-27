import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import {
  CHAT_HISTORY,
  type ChatHistoryDTO,
  type ChatMessageDTO,
  type ChatPushDTO,
  type LiveRoom,
} from "@snakeland/shared";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { GameError } from "../games/errors";
import type { SessionUser } from "../http/session";
import type { Bus } from "../realtime/bus";
import type { LiveBusMessage } from "../realtime/messages";
import { cleanChat } from "./filter";

const TTL_S = 24 * 60 * 60;
/** At most BURST messages per WINDOW_S, and never two within GAP_MS. */
const BURST = 5;
const WINDOW_S = 15;
const GAP_MS = 1_200;

export interface ChatStore {
  history(room: LiveRoom): Promise<ChatMessageDTO[]>;
  append(room: LiveRoom, m: ChatMessageDTO): Promise<void>;
  /** True if the user may post now (and counts this post). */
  allow(userId: string): Promise<boolean>;
}

/** Last 50 messages per room in a Redis list that expires after a day of silence. Nothing hits Postgres. */
export class RedisChatStore implements ChatStore {
  constructor(private readonly redis: Redis) {}
  async history(room: LiveRoom) {
    const raw = await this.redis.lrange(
      `snk:chat:${room}`,
      0,
      CHAT_HISTORY - 1,
    );
    return raw.map((r) => JSON.parse(r) as ChatMessageDTO).reverse();
  }
  async append(room: LiveRoom, m: ChatMessageDTO) {
    const key = `snk:chat:${room}`;
    await this.redis
      .multi()
      .lpush(key, JSON.stringify(m))
      .ltrim(key, 0, CHAT_HISTORY - 1)
      .expire(key, TTL_S)
      .exec();
  }
  async allow(userId: string) {
    const gap = await this.redis.set(
      `snk:chat:gap:${userId}`,
      "1",
      "PX",
      GAP_MS,
      "NX",
    );
    if (gap !== "OK") return false;
    const key = `snk:chat:rl:${userId}`;
    const [[, n]] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, WINDOW_S, "NX")
      .exec()) as [[null, number], unknown];
    return n <= BURST;
  }
}

export class MemoryChatStore implements ChatStore {
  private rooms = new Map<LiveRoom, ChatMessageDTO[]>();
  private posts = new Map<string, number[]>();
  constructor(private readonly now = () => Date.now()) {}
  async history(room: LiveRoom) {
    return [...(this.rooms.get(room) ?? [])];
  }
  async append(room: LiveRoom, m: ChatMessageDTO) {
    this.rooms.set(
      room,
      [...(this.rooms.get(room) ?? []), m].slice(-CHAT_HISTORY),
    );
  }
  async allow(userId: string) {
    const t = this.now();
    const recent = (this.posts.get(userId) ?? []).filter(
      (p) => t - p < WINDOW_S * 1000,
    );
    if (
      recent.length >= BURST ||
      (recent.length && t - recent.at(-1)! < GAP_MS)
    )
      return false;
    this.posts.set(userId, [...recent, t]);
    return true;
  }
}

export class ChatService {
  constructor(
    private readonly db: Db,
    private readonly store: ChatStore,
    private readonly bus: Bus,
  ) {}

  private async muted(userId: string) {
    const [u] = await this.db
      .select({ m: users.chatMutedAt })
      .from(users)
      .where(eq(users.id, userId));
    return Boolean(u?.m);
  }

  async history(user: SessionUser, room: LiveRoom): Promise<ChatHistoryDTO> {
    const [messages, muted] = await Promise.all([
      this.store.history(room),
      user.isAnonymous ? false : this.muted(user.id),
    ]);
    const reason = user.isAnonymous ? "guest" : muted ? "muted" : null;
    return { messages, canPost: reason === null, reason };
  }

  async post(
    user: SessionUser,
    room: LiveRoom,
    raw: string,
  ): Promise<ChatMessageDTO> {
    if (user.isAnonymous)
      throw new GameError(
        403,
        "SIGN_UP_REQUIRED",
        "Create a free account to chat",
      );
    if (await this.muted(user.id))
      throw new GameError(403, "CHAT_MUTED", "You've been muted in chat");
    const text = cleanChat(raw);
    if (!text) throw new GameError(400, "EMPTY_MESSAGE", "Say something");
    if (!(await this.store.allow(user.id)))
      throw new GameError(429, "SLOW_DOWN", "Slow down a little");
    const message: ChatMessageDTO = {
      id: randomUUID(),
      kind: "user",
      userId: user.id,
      name: user.name,
      text,
      at: new Date().toISOString(),
    };
    await this.store.append(room, message);
    await this.bus.publish({
      kind: "room",
      room,
      message: { type: "chat", message } satisfies ChatPushDTO,
    } satisfies LiveBusMessage);
    return message;
  }

  /** Post a system line (tips, rain, notices). Not rate-limited; not user-authored. */
  async system(room: LiveRoom, text: string): Promise<ChatMessageDTO> {
    const message: ChatMessageDTO = {
      id: randomUUID(),
      kind: "system",
      userId: "",
      name: "",
      text: text.slice(0, 300),
      at: new Date().toISOString(),
    };
    await this.store.append(room, message);
    await this.bus.publish({
      kind: "room",
      room,
      message: { type: "chat", message } satisfies ChatPushDTO,
    } satisfies LiveBusMessage);
    return message;
  }

  /** Distinct registered authors from a room's recent history (for rain splits). */
  async recentAuthors(room: LiveRoom, limit = 30): Promise<{ id: string; name: string }[]> {
    const seen = new Map<string, string>();
    for (const m of await this.store.history(room)) if (m.userId && !seen.has(m.userId)) seen.set(m.userId, m.name);
    return [...seen].slice(0, limit).map(([id, name]) => ({ id, name }));
  }
}
