import { ROULETTE_WHEELS, type WheelId } from "./roulette";

/**
 * Live rooms share one WebSocket endpoint. A browser joins exactly one room;
 * the server only runs a room's game loop while someone is in it.
 */
export const rouletteRoom = (wheelId: WheelId) => `roulette:${wheelId}` as const;
export const CRASH_ROOM = "crash" as const;
export const LIVE_ROOMS = [...ROULETTE_WHEELS.map((w) => rouletteRoom(w.id)), CRASH_ROOM] as const;
export type LiveRoom = (typeof LIVE_ROOMS)[number];
export const isLiveRoom = (v: unknown): v is LiveRoom => typeof v === "string" && (LIVE_ROOMS as readonly string[]).includes(v);

export type LiveClientMessage = { type: "join"; room: LiveRoom } | { type: "ping" };

// ---------------------------------------------------------------- Live chat

export const CHAT_MAX_LENGTH = 200;
export const CHAT_HISTORY = 50;

export interface ChatMessageDTO {
  id: string;
  /** Empty for system lines (tips, rain, admin notices). */
  userId: string;
  name: string;
  text: string;
  at: string;
  /** "user" (default) or "system" (tips, rain, notices). */
  kind?: "user" | "system";
}

export interface ChatHistoryDTO {
  messages: ChatMessageDTO[];
  /** Guests can read; registered, unmuted players can post. */
  canPost: boolean;
  reason: "guest" | "muted" | null;
}

/** Pushed to everyone in the room when someone posts. */
export interface ChatPushDTO {
  type: "chat";
  message: ChatMessageDTO;
}
