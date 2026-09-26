/**
 * REST and auth calls are same-origin (proxied to the API by this app), so the
 * base is empty. Only the live-game WebSocket connects to the API directly.
 */
export const API_URL = "";
export const WS_URL = (process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000").replace(/\/$/, "");
