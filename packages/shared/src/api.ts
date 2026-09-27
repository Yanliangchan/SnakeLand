import type { Chips, TransactionType } from "./money";
import type { GameId } from "./games";

export interface WalletDTO {
  balance: Chips;
  /** ISO timestamp when the next daily claim unlocks, or null if claimable now. */
  nextDailyClaimAt: string | null;
}

export interface TransactionDTO {
  id: string;
  game: GameId | null;
  tableId: string | null;
  roundId: string | null;
  amount: Chips;
  type: TransactionType;
  balanceAfter: Chips;
  createdAt: string;
}

export interface TransactionPageDTO {
  items: TransactionDTO[];
  nextCursor: string | null;
}

export interface MeDTO {
  user: {
    id: string;
    name: string;
    email: string | null;
    isGuest: boolean;
  };
  wallet: WalletDTO;
}

export interface ApiErrorDTO {
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------- Push notifications

export interface PushConfigDTO {
  enabled: boolean;
  /** VAPID application server key (base64url). */
  publicKey: string | null;
}

export interface PushPrefsDTO {
  daily: boolean;
  titles: boolean;
}
