import type {
  AdminAnnouncementDTO,
  AnnouncementDTO,
  LiveRoom,
  ReferralStateDTO,
  SpinResultDTO,
  SpinStateDTO,
} from "@snakeland/shared";
import { api } from "./api";

export const engagementApi = {
  spinState: () => api<SpinStateDTO>("/v1/spin/state"),
  spin: () => api<SpinResultDTO>("/v1/spin", { method: "POST", body: {} }),
  referral: () => api<ReferralStateDTO>("/v1/referral"),
  redeemReferral: (code: string) => api<{ ok: boolean; reward: number }>("/v1/referral/redeem", { method: "POST", body: { code } }),
  announcement: () => api<{ announcement: AnnouncementDTO | null }>("/v1/announcement"),
  tip: (room: LiveRoom, toUserId: string, amount: number) =>
    api<{ balance: number }>(`/v1/live/chat/${encodeURIComponent(room)}/tip`, { method: "POST", body: { toUserId, amount } }),
};

export const adminEngagementApi = {
  rain: (room: LiveRoom, amount: number) => api<{ recipients: number; each: number }>("/v1/admin/rain", { method: "POST", body: { room, amount } }),
  announcements: () => api<{ announcements: AdminAnnouncementDTO[] }>("/v1/admin/announcements"),
  createAnnouncement: (body: { body: string; level: string; href: string | null; active: boolean }) =>
    api<{ id: string }>("/v1/admin/announcements", { method: "POST", body }),
  setAnnouncementActive: (id: string, active: boolean) =>
    api(`/v1/admin/announcements/${encodeURIComponent(id)}/active`, { method: "POST", body: { active } }),
  deleteAnnouncement: (id: string) => api(`/v1/admin/announcements/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} }),
};
