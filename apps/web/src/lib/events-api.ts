import type { AdminEventInput, CrashRaceResultDTO, EventDetailDTO, EventEntryDTO, EventListDTO, EventSummaryDTO } from "@snakeland/shared";
import { api } from "./api";

export const eventsApi = {
  list: () => api<EventListDTO>("/v1/events"),
  detail: (id: string) => api<EventDetailDTO>(`/v1/events/${encodeURIComponent(id)}`),
  join: (id: string) => api<EventEntryDTO>(`/v1/events/${encodeURIComponent(id)}/join`, { method: "POST", body: {} }),
  crash: (id: string, bet: number, targetX100: number) =>
    api<CrashRaceResultDTO>(`/v1/events/${encodeURIComponent(id)}/crash`, { method: "POST", body: { bet, targetX100 } }),
};

export const adminEventsApi = {
  list: () => api<{ events: EventSummaryDTO[] }>("/v1/admin/events"),
  create: (input: AdminEventInput) => api<{ id: string }>("/v1/admin/events", { method: "POST", body: input }),
  cancel: (id: string) => api<{ refunded: number }>(`/v1/admin/events/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} }),
};

/** "12:04" / "1h 05m" / "2d 3h" until `iso`, from a server-synced clock. */
export function countdown(iso: string, now: number): string {
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export const RACE_GAME_NAME = { mines: "Mines", hilo: "Hi-Lo", crash: "Crash" } as const;
