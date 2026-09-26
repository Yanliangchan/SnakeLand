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
