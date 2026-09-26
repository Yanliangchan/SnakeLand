import type { WebSocket } from "ws";
import { z } from "zod";
import { LIVE_ROOMS, type LiveRoom } from "@snakeland/shared";
import type { Bus } from "./bus";
import type { LiveBusMessage } from "./messages";
import type { Presence, RoomCounts } from "./presence";

const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), room: z.enum(LIVE_ROOMS as unknown as [LiveRoom, ...LiveRoom[]]) }),
  z.object({ type: z.literal("ping") }),
]);

const MAX_SOCKETS_PER_USER = 5;
const MSG_BUDGET = 30; // messages per window
const MSG_WINDOW_MS = 10_000;
const HEARTBEAT_MS = 25_000;
const PRESENCE_MS = 5_000;

interface Client {
  socket: WebSocket;
  userId: string;
  room: LiveRoom | null;
  alive: boolean;
  budget: number;
  windowStart: number;
}

/** Loads what a socket sees when it joins a room (the room's current state). */
export type RoomSnapshot = (room: LiveRoom, userId: string) => Promise<unknown>;

/**
 * This instance's live-game WebSockets. Each socket sits in one room (a
 * roulette wheel, or crash). Bus messages from any instance are routed to the
 * sockets in that room, or to one user's sockets. Timers only run while at
 * least one socket is connected.
 */
export class LiveHub {
  private clients = new Set<Client>();
  private readonly unsubscribe: () => void;
  private heartbeat: NodeJS.Timeout | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly bus: Bus,
    private readonly presence: Presence,
    private readonly snapshot: RoomSnapshot,
  ) {
    this.unsubscribe = bus.subscribe((m) => this.route(m as LiveBusMessage));
  }

  private counts(): RoomCounts {
    const out: RoomCounts = {};
    for (const c of this.clients) if (c.room) out[c.room] = (out[c.room] ?? 0) + 1;
    return out;
  }

  private reportPresence() {
    return this.presence.report(this.counts());
  }

  /** Start timers with the first socket, stop them with the last. */
  private syncTimers() {
    if (this.clients.size > 0 && !this.heartbeat) {
      this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
      this.presenceTimer = setInterval(() => void this.reportPresence(), PRESENCE_MS);
      this.heartbeat.unref();
      this.presenceTimer.unref();
    } else if (this.clients.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      clearInterval(this.presenceTimer!);
      this.heartbeat = this.presenceTimer = null;
    }
  }

  private send(c: Client, message: unknown) {
    if (c.socket.readyState !== c.socket.OPEN) return;
    const type = message && typeof message === "object" ? (message as { type?: string }).type : undefined;
    // State snapshots carry the server clock so countdowns match server deadlines.
    const withClock = type === "state" || type === "crash-state" ? { ...(message as object), serverNow: new Date().toISOString() } : message;
    c.socket.send(JSON.stringify(withClock));
  }

  private route(m: LiveBusMessage) {
    if (m.kind === "wake") return;
    for (const c of this.clients) {
      if (m.kind === "room" && c.room === m.room) this.send(c, m.message);
      else if (m.kind === "user" && c.userId === m.userId) this.send(c, m.message);
    }
  }

  private beat() {
    for (const c of this.clients) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
    }
  }

  attach(socket: WebSocket, userId: string) {
    const mine = [...this.clients].filter((c) => c.userId === userId);
    if (mine.length >= MAX_SOCKETS_PER_USER) {
      socket.close(1008, "Too many connections");
      return;
    }
    const client: Client = { socket, userId, room: null, alive: true, budget: MSG_BUDGET, windowStart: Date.now() };
    this.clients.add(client);
    this.syncTimers();

    socket.on("pong", () => (client.alive = true));
    socket.on("close", () => {
      this.clients.delete(client);
      void this.reportPresence();
      this.syncTimers();
    });
    socket.on("error", () => socket.terminate());
    socket.on("message", (raw, isBinary) => {
      const now = Date.now();
      if (now - client.windowStart > MSG_WINDOW_MS) {
        client.windowStart = now;
        client.budget = MSG_BUDGET;
      }
      if (--client.budget < 0) {
        socket.close(1008, "Slow down");
        return;
      }
      if (isBinary) return;
      let parsed: z.infer<typeof ClientMessage>;
      try {
        parsed = ClientMessage.parse(JSON.parse(raw.toString()));
      } catch {
        this.send(client, { type: "error", message: "Bad message" });
        return;
      }
      if (parsed.type === "ping") {
        this.send(client, { type: "pong", serverNow: new Date().toISOString() });
        return;
      }
      const room = parsed.room;
      client.room = room;
      // Report straight away and wake that room's game loop in case it was asleep.
      void this.reportPresence().then(() => this.bus.publish({ kind: "wake", room } satisfies LiveBusMessage));
      void this.snapshot(room, userId)
        .then((message) => client.room === room && this.send(client, message))
        .catch(() => this.send(client, { type: "error", message: "Couldn't load the game" }));
    });
  }

  async close() {
    this.unsubscribe();
    for (const c of this.clients) c.socket.close(1001, "Server shutting down");
    this.clients.clear();
    this.syncTimers();
  }
}
