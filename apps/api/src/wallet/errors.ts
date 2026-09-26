export type WalletErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "BALANCE_LIMIT"
  | "INVALID_AMOUNT"
  | "DAILY_CLAIM_NOT_READY"
  | "WALLET_NOT_FOUND"
  | "INVALID_CURSOR";

export class WalletError extends Error {
  constructor(
    readonly code: WalletErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WalletError";
  }
}
