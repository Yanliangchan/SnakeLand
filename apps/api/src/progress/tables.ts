// Progress reads the wallet counters directly (read-only). Balance changes still go through WalletService.
// eslint-disable-next-line no-restricted-imports
export { wallets as walletStatsTable } from "../db/schema";
