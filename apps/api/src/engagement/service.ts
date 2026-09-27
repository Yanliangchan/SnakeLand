import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  ANNOUNCEMENT_LEVELS,
  REFERRAL_REWARD,
  REFERRAL_WINDOW_HOURS,
  TIP_MAX,
  TIP_MIN,
  type AdminAnnouncementDTO,
  type AnnouncementDTO,
  type AnnouncementLevel,
  type LiveRoom,
  type ReferralStateDTO,
} from "@snakeland/shared";
import type { Db } from "../db/client";
import { announcements, users } from "../db/schema";
import type { ChatService } from "../chat/service";
import { GameError } from "../games/errors";
import type { SessionUser } from "../http/session";
import type { WalletService } from "../wallet/wallet-service";

export class EngagementService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly chat: ChatService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ---------------------------------------------------------------- referrals

  async referralState(userId: string): Promise<ReferralStateDTO> {
    const [[referred], earned] = await Promise.all([
      this.db.select({ n: count() }).from(users).where(eq(users.referredBy, userId)),
      // Read-only sum by table name (WalletService owns the transactions object).
      this.db.execute<{ sum: string }>(
        sql`SELECT coalesce(sum(amount), 0)::bigint AS sum FROM transactions WHERE user_id = ${userId} AND type = 'referral'`,
      ),
    ]);
    return { code: userId, referred: referred?.n ?? 0, earned: Number(earned.rows[0]?.sum ?? 0), reward: REFERRAL_REWARD };
  }

  /** A newly-registered player redeems a referral code: both sides get chips, once. */
  async redeemReferral(user: SessionUser, code: string): Promise<{ ok: boolean; reward: number }> {
    if (user.isAnonymous) throw new GameError(403, "SIGN_UP_REQUIRED", "Create an account first");
    if (code === user.id) throw new GameError(400, "SELF_REFERRAL", "You can't refer yourself");
    const [me] = await this.db
      .select({ createdAt: users.createdAt, referredBy: users.referredBy })
      .from(users)
      .where(eq(users.id, user.id));
    if (!me) throw new GameError(404, "NOT_FOUND", "Account not found");
    if (me.referredBy) return { ok: false, reward: 0 };
    if (this.clock().getTime() - me.createdAt.getTime() > REFERRAL_WINDOW_HOURS * 3_600_000) {
      throw new GameError(409, "REFERRAL_EXPIRED", "Referral links only work just after signing up");
    }
    const [referrer] = await this.db
      .select({ id: users.id, isAnonymous: users.isAnonymous })
      .from(users)
      .where(eq(users.id, code));
    if (!referrer || referrer.isAnonymous) throw new GameError(404, "INVALID_CODE", "That referral link isn't valid");

    return this.db.transaction(async (tx) => {
      // Claim the slot atomically: only set referred_by if still empty.
      const [claimed] = await tx
        .update(users)
        .set({ referredBy: code })
        .where(and(eq(users.id, user.id), sql`${users.referredBy} IS NULL`))
        .returning({ id: users.id });
      if (!claimed) return { ok: false, reward: 0 };
      await this.wallet.apply(
        { userId: user.id, amount: REFERRAL_REWARD, type: "referral", idempotencyKey: `ref:in:${user.id}`, meta: { from: code } },
        tx,
      );
      await this.wallet.apply(
        { userId: code, amount: REFERRAL_REWARD, type: "referral", idempotencyKey: `ref:out:${user.id}`, meta: { referred: user.id } },
        tx,
      );
      return { ok: true, reward: REFERRAL_REWARD };
    });
  }

  // ---------------------------------------------------------------- tips

  async tip(from: SessionUser, room: LiveRoom, toUserId: string, amount: number): Promise<{ balance: number }> {
    if (from.isAnonymous) throw new GameError(403, "SIGN_UP_REQUIRED", "Create an account to tip");
    if (toUserId === from.id) throw new GameError(400, "SELF_TIP", "You can't tip yourself");
    if (!Number.isSafeInteger(amount) || amount < TIP_MIN || amount > TIP_MAX) {
      throw new GameError(400, "TIP_OUT_OF_RANGE", `Tips are ${TIP_MIN}–${TIP_MAX.toLocaleString()} chips`);
    }
    const [to] = await this.db.select({ name: users.name, isAnonymous: users.isAnonymous }).from(users).where(eq(users.id, toUserId));
    if (!to || to.isAnonymous) throw new GameError(404, "NO_RECIPIENT", "That player can't receive tips");
    const result = await this.db.transaction(async (tx) => {
      const debit = await this.wallet.apply({ userId: from.id, amount: -amount, type: "tip", meta: { to: toUserId } }, tx);
      await this.wallet.apply({ userId: toUserId, amount, type: "tip", meta: { from: from.id } }, tx);
      return debit;
    });
    await this.chat.system(room, `🎁 ${from.name} tipped ${to.name} ${amount.toLocaleString()} chips`);
    return { balance: result.balance };
  }

  // ---------------------------------------------------------------- rain (admin)

  /** Admin-funded rain: split among the room's recent chatters. */
  async rain(room: LiveRoom, amount: number): Promise<{ recipients: number; each: number }> {
    if (!Number.isSafeInteger(amount) || amount < 10 || amount > 10_000_000) {
      throw new GameError(400, "RAIN_OUT_OF_RANGE", "Rain must be 10–10,000,000 chips");
    }
    const authors = await this.chat.recentAuthors(room);
    if (authors.length === 0) throw new GameError(409, "NO_ONE_HERE", "Nobody has chatted here recently");
    const each = Math.floor(amount / authors.length);
    if (each < 1) throw new GameError(400, "RAIN_TOO_SMALL", "Not enough to split");
    for (const a of authors) {
      await this.wallet.apply({ userId: a.id, amount: each, type: "rain", meta: { room } });
    }
    await this.chat.system(
      room,
      `☔ It's raining chips! ${each.toLocaleString()} each to ${authors.length} player${authors.length === 1 ? "" : "s"}`,
    );
    return { recipients: authors.length, each };
  }

  // ---------------------------------------------------------------- announcements

  async active(): Promise<AnnouncementDTO | null> {
    const [row] = await this.db
      .select()
      .from(announcements)
      .where(eq(announcements.active, true))
      .orderBy(desc(announcements.createdAt))
      .limit(1);
    if (!row) return null;
    return { id: row.id, body: row.body, level: row.level as AnnouncementLevel, href: row.href };
  }

  async adminList(): Promise<AdminAnnouncementDTO[]> {
    const rows = await this.db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(50);
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      level: r.level as AnnouncementLevel,
      href: r.href,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createAnnouncement(input: { body: string; level: AnnouncementLevel; href: string | null; active: boolean }): Promise<string> {
    if (!ANNOUNCEMENT_LEVELS.includes(input.level)) throw new GameError(400, "BAD_LEVEL", "Unknown level");
    return this.db.transaction(async (tx) => {
      // Only one active at a time.
      if (input.active) await tx.update(announcements).set({ active: false }).where(eq(announcements.active, true));
      const [row] = await tx.insert(announcements).values(input).returning({ id: announcements.id });
      return row!.id;
    });
  }

  async setAnnouncementActive(id: string, active: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (active) await tx.update(announcements).set({ active: false }).where(eq(announcements.active, true));
      const [row] = await tx.update(announcements).set({ active }).where(eq(announcements.id, id)).returning({ id: announcements.id });
      if (!row) throw new GameError(404, "NOT_FOUND", "Announcement not found");
    });
  }

  async removeAnnouncement(id: string): Promise<void> {
    const gone = await this.db.delete(announcements).where(eq(announcements.id, id)).returning({ id: announcements.id });
    if (!gone.length) throw new GameError(404, "NOT_FOUND", "Announcement not found");
  }
}
