import { sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";

export const GAME_DATA_RETENTION_DAYS = 7;
export const GUEST_INACTIVE_DAYS = 3;
const BATCH = 2_000;

export interface PurgeReport {
  guests: number;
  rows: Record<string, number>;
}

/**
 * Removes data nobody needs any more. Registered accounts and their money
 * records are never touched automatically; guests are removed completely.
 * Only an admin can delete a registered player (`purgePlayer`).
 */
export class PurgeService {
  constructor(private readonly db: Db) {}

  /** Delete a guest and everything they own. Refuses registered accounts. */
  async purgeGuest(userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const found = await tx.execute<{ id: string }>(
        sql`SELECT id FROM users WHERE id = ${userId} AND is_anonymous = true FOR UPDATE`,
      );
      if (found.rows.length === 0) return false;
      await this.deleteUserData(tx, userId);
      return true;
    });
  }

  /**
   * Admin-only: delete any player (guest or registered) and everything they
   * own, ledger included. Returns who was deleted, or null if not found.
   */
  async purgePlayer(userId: string): Promise<{ name: string; email: string; isAnonymous: boolean } | null> {
    return this.db.transaction(async (tx) => {
      const found = await tx.execute<{ name: string; email: string; is_anonymous: boolean }>(
        sql`SELECT name, email, is_anonymous FROM users WHERE id = ${userId} FOR UPDATE`,
      );
      const u = found.rows[0];
      if (!u) return null;
      await this.deleteUserData(tx, userId);
      return { name: u.name, email: u.email, isAnonymous: u.is_anonymous };
    });
  }

  private async deleteUserData(tx: Tx, userId: string) {
    // The ledger trigger only allows deletes inside a transaction that opts in.
    await tx.execute(sql`SET LOCAL snk.purge = 'on'`);
    const statements = [
      sql`DELETE FROM roulette_bets WHERE user_id = ${userId}`,
      sql`DELETE FROM crash_bets WHERE user_id = ${userId}`,
      sql`DELETE FROM blackjack_rounds WHERE user_id = ${userId}`,
      sql`DELETE FROM blackjack_shoes WHERE user_id = ${userId}`,
      sql`DELETE FROM blackjack_tables WHERE user_id = ${userId}`,
      sql`DELETE FROM baccarat_rounds WHERE user_id = ${userId}`,
      sql`DELETE FROM baccarat_shoes WHERE user_id = ${userId}`,
      sql`DELETE FROM baccarat_tables WHERE user_id = ${userId}`,
      sql`DELETE FROM mines_rounds WHERE user_id = ${userId}`,
      sql`DELETE FROM plinko_drops WHERE user_id = ${userId}`,
      sql`DELETE FROM carrier_flights WHERE user_id = ${userId}`,
      sql`DELETE FROM ladder_rounds WHERE user_id = ${userId}`,
      sql`DELETE FROM fair_seeds WHERE user_id = ${userId}`,
      sql`DELETE FROM transactions WHERE user_id = ${userId}`,
      sql`DELETE FROM wallets WHERE user_id = ${userId}`,
      // Sessions and accounts cascade from users.
      sql`DELETE FROM users WHERE id = ${userId}`,
    ];
    for (const statement of statements) await tx.execute(statement);
  }

  /** Guests with no session activity for a few days: they left without saying so. */
  async purgeInactiveGuests(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - GUEST_INACTIVE_DAYS * 86_400_000);
    const stale = await this.db.execute<{ id: string }>(sql`
      SELECT u.id FROM users u
      WHERE u.is_anonymous = true
        AND u.updated_at < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.updated_at >= ${cutoff})
      LIMIT 500`);
    let n = 0;
    for (const { id } of stale.rows) if (await this.purgeGuest(id)) n++;
    return n;
  }

  /** Delete matching rows in small batches so no single statement holds locks for long. */
  private async batched(label: string, rows: Record<string, number>, statement: () => ReturnType<typeof sql>) {
    let total = 0;
    for (;;) {
      const res = await this.db.execute(statement());
      const n = res.rowCount ?? 0;
      total += n;
      if (n < BATCH) break;
    }
    if (total) rows[label] = total;
  }

  /** Finished game data older than the retention window, plus expired auth rows. */
  async purgeOldGameData(now = new Date()): Promise<Record<string, number>> {
    const cutoff = new Date(now.getTime() - GAME_DATA_RETENTION_DAYS * 86_400_000);
    const rows: Record<string, number> = {};
    const b = (label: string, statement: () => ReturnType<typeof sql>) => this.batched(label, rows, statement);

    await b("roulette_bets", () => sql`DELETE FROM roulette_bets WHERE id IN (
      SELECT b.id FROM roulette_bets b JOIN roulette_rounds r ON r.id = b.round_id
      WHERE r.phase = 'settled' AND r.settled_at < ${cutoff} LIMIT ${BATCH})`);
    await b("roulette_rounds", () => sql`DELETE FROM roulette_rounds WHERE id IN (
      SELECT r.id FROM roulette_rounds r WHERE r.phase = 'settled' AND r.settled_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM roulette_bets b WHERE b.round_id = r.id) LIMIT ${BATCH})`);

    await b("crash_bets", () => sql`DELETE FROM crash_bets WHERE id IN (
      SELECT b.id FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id
      WHERE r.phase = 'crashed' AND r.crashed_at < ${cutoff} LIMIT ${BATCH})`);
    await b("crash_rounds", () => sql`DELETE FROM crash_rounds WHERE id IN (
      SELECT r.id FROM crash_rounds r WHERE r.phase = 'crashed' AND r.crashed_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM crash_bets b WHERE b.round_id = r.id) LIMIT ${BATCH})`);

    await b("blackjack_rounds", () => sql`DELETE FROM blackjack_rounds WHERE id IN (
      SELECT id FROM blackjack_rounds WHERE status = 'settled' AND settled_at < ${cutoff} LIMIT ${BATCH})`);
    await b("blackjack_shoes", () => sql`DELETE FROM blackjack_shoes WHERE id IN (
      SELECT s.id FROM blackjack_shoes s WHERE s.revealed_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM blackjack_rounds r WHERE r.shoe_id = s.id) LIMIT ${BATCH})`);
    await b("blackjack_tables", () => sql`DELETE FROM blackjack_tables WHERE id IN (
      SELECT t.id FROM blackjack_tables t WHERE t.closed_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM blackjack_shoes s WHERE s.table_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM blackjack_rounds r WHERE r.table_id = t.id) LIMIT ${BATCH})`);

    await b("baccarat_rounds", () => sql`DELETE FROM baccarat_rounds WHERE id IN (
      SELECT id FROM baccarat_rounds WHERE created_at < ${cutoff} LIMIT ${BATCH})`);
    await b("baccarat_shoes", () => sql`DELETE FROM baccarat_shoes WHERE id IN (
      SELECT s.id FROM baccarat_shoes s WHERE s.revealed_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM baccarat_rounds r WHERE r.shoe_id = s.id) LIMIT ${BATCH})`);
    await b("baccarat_tables", () => sql`DELETE FROM baccarat_tables WHERE id IN (
      SELECT t.id FROM baccarat_tables t WHERE t.closed_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM baccarat_shoes s WHERE s.table_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM baccarat_rounds r WHERE r.table_id = t.id) LIMIT ${BATCH})`);

    await b("mines_rounds", () => sql`DELETE FROM mines_rounds WHERE id IN (
      SELECT id FROM mines_rounds WHERE status <> 'playing' AND settled_at < ${cutoff} LIMIT ${BATCH})`);
    await b("plinko_drops", () => sql`DELETE FROM plinko_drops WHERE id IN (
      SELECT id FROM plinko_drops WHERE created_at < ${cutoff} LIMIT ${BATCH})`);

    await b("carrier_flights", () => sql`DELETE FROM carrier_flights WHERE id IN (
      SELECT id FROM carrier_flights WHERE created_at < ${cutoff} LIMIT ${BATCH})`);
    await b("ladder_rounds", () => sql`DELETE FROM ladder_rounds WHERE id IN (
      SELECT id FROM ladder_rounds WHERE status <> 'playing' AND settled_at < ${cutoff} LIMIT ${BATCH})`);

    await b("sessions", () => sql`DELETE FROM sessions WHERE id IN (
      SELECT id FROM sessions WHERE expires_at < ${now} LIMIT ${BATCH})`);
    await b("verifications", () => sql`DELETE FROM verifications WHERE id IN (
      SELECT id FROM verifications WHERE expires_at < ${now} LIMIT ${BATCH})`);
    await b("rate_limits", () => sql`DELETE FROM rate_limits WHERE id IN (
      SELECT id FROM rate_limits WHERE last_request < ${now.getTime() - 86_400_000} LIMIT ${BATCH})`);
    await b("admin_audit", () => sql`DELETE FROM admin_audit WHERE id IN (
      SELECT id FROM admin_audit WHERE created_at < ${new Date(now.getTime() - 90 * 86_400_000)} LIMIT ${BATCH})`);
    return rows;
  }
}
