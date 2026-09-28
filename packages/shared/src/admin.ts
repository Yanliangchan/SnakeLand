import type { Chips, TransactionType } from "./money";
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
  /** Muted players can read live chat but not post. */
  chatMutedAt: string | null;
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

// ---------------------------------------------------------------- overview dashboard

export interface AdminDayDTO {
  /** YYYY-MM-DD (UTC). */
  day: string;
  signups: number;
  active: number;
  wagered: Chips;
  /** Bets minus payouts and refunds: positive means the house won. */
  houseNet: Chips;
}

export interface AdminGameStatDTO {
  game: string;
  rounds: number;
  players: number;
  wagered: Chips;
  paidOut: Chips;
  houseNet: Chips;
}

export interface AdminPlayerNetDTO {
  userId: string;
  name: string;
  net: Chips;
}

export interface AdminAuditEntryDTO {
  id: string;
  action: string;
  targetUserId: string | null;
  detail: Record<string, unknown> | null;
  at: string;
}

export interface AdminOverviewDTO {
  generatedAt: string;
  totals: {
    players: number;
    guests: number;
    active24h: number;
    signups24h: number;
    signups7d: number;
    chipsInPlay: Chips;
    wagered24h: Chips;
    houseNet24h: Chips;
    rounds24h: number;
  };
  /** The last 14 days, oldest first. */
  days: AdminDayDTO[];
  /** Last 7 days, busiest first. */
  games: AdminGameStatDTO[];
  /** Chips created (positive) or removed (negative) outside game play in the last 7 days, by transaction type. */
  flows: Array<{ type: TransactionType; amount: Chips }>;
  winners24h: AdminPlayerNetDTO[];
  losers24h: AdminPlayerNetDTO[];
  /** People connected to each live room right now. */
  liveRooms: Array<{ room: string; viewers: number }>;
  liveEvents: number;
  audit: AdminAuditEntryDTO[];
}
