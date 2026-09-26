import type { LiveRoom } from "@snakeland/shared";

/** Messages carried on the live bus; every instance's hub routes them to its sockets. */
export type LiveBusMessage =
  | { kind: "room"; room: LiveRoom; message: unknown }
  | { kind: "user"; userId: string; message: unknown }
  /** Someone joined a room: its game loop should wake up now. */
  | { kind: "wake"; room: LiveRoom };
