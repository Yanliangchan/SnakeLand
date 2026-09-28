import type {
  AdminBalanceMode,
  AdminLabChallengeDTO,
  AdminLabChallengeInput,
  AdminPlayerDetailDTO,
  AdminPlayerPageDTO,
  AdminOverviewDTO,
  AdminStatsDTO,
} from "@snakeland/shared";
import { api } from "./api";

export type PlayerFilter = "all" | "players" | "guests" | "suspended";

const p = (id: string) => `/v1/admin/players/${encodeURIComponent(id)}`;

export const adminApi = {
  session: () => api<{ ok: true }>("/v1/admin/session"),
  login: (password: string) => api<{ ok: true }>("/v1/admin/login", { method: "POST", body: { password } }),
  logout: () => api<{ ok: true }>("/v1/admin/logout", { method: "POST", body: {} }),
  stats: () => api<AdminStatsDTO>("/v1/admin/stats"),
  overview: () => api<AdminOverviewDTO>("/v1/admin/overview"),
  players: (q: { q?: string; filter: PlayerFilter; cursor?: string }) => {
    const params = new URLSearchParams({ filter: q.filter, limit: "50" });
    if (q.q) params.set("q", q.q);
    if (q.cursor) params.set("cursor", q.cursor);
    return api<AdminPlayerPageDTO>(`/v1/admin/players?${params}`);
  },
  player: (id: string) => api<AdminPlayerDetailDTO>(p(id)),
  balance: (id: string, body: { mode: AdminBalanceMode; amount: number; note?: string }) =>
    api<{ balance: number }>(`${p(id)}/balance`, { method: "POST", body }),
  resetClaim: (id: string) => api(`${p(id)}/reset-claim`, { method: "POST", body: {} }),
  rename: (id: string, name: string) => api<{ name: string }>(`${p(id)}/rename`, { method: "POST", body: { name } }),
  suspend: (id: string, suspended: boolean) => api(`${p(id)}/suspend`, { method: "POST", body: { suspended } }),
  signOut: (id: string) => api<{ sessions: number }>(`${p(id)}/sign-out`, { method: "POST", body: {} }),
  /** Permanent. The server requires the id repeated as confirmation. */
  deletePlayer: (id: string) => api(`${p(id)}/delete`, { method: "POST", body: { confirmId: id } }),
  chatMute: (id: string, muted: boolean) => api(`${p(id)}/chat-mute`, { method: "POST", body: { muted } }),
  lab: () => api<{ challenges: AdminLabChallengeDTO[] }>("/v1/admin/lab"),
  labCreate: (body: AdminLabChallengeInput) => api<{ id: string }>("/v1/admin/lab", { method: "POST", body }),
  labUpdate: (id: string, body: AdminLabChallengeInput) =>
    api(`/v1/admin/lab/${encodeURIComponent(id)}`, { method: "POST", body }),
  labDelete: (id: string) => api(`/v1/admin/lab/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} }),
};
