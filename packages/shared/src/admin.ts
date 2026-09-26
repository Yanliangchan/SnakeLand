import type { Chips } from "./money";
import type { ProfileDTO } from "./progress";
import type { TransactionDTO } from "./api";

export interface AdminPlayerRowDTO {
  id: string;
  name: string;
  email: string | null;
  isGuest: boolean;
  suspended: boolean;
  balance: Chips;
  allTimeProfit: Chips;
  weeklyProfit: Chips;
  joinedAt: string;
  lastSeenAt: string | null;
}

export interface AdminPlayerPageDTO {
  items: AdminPlayerRowDTO[];
  nextCursor: string | null;
  total: number;
}

export interface AdminAuditDTO {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminPlayerDetailDTO {
  profile: ProfileDTO;
  suspendedAt: string | null;
  activeSessions: number;
  lastSeenAt: string | null;
  transactions: TransactionDTO[];
  audit: AdminAuditDTO[];
}

export interface AdminStatsDTO {
  players: number;
  guests: number;
  suspended: number;
  chipsInPlay: Chips;
  activeToday: number;
}

export const ADMIN_BALANCE_MODES = ["adjust", "set"] as const;
export type AdminBalanceMode = (typeof ADMIN_BALANCE_MODES)[number];
