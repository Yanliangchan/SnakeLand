import { and, count, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { PushConfigDTO, PushPrefsDTO } from "@snakeland/shared";
import type { Db } from "../db/client";
import { pushSubscriptions, users } from "../db/schema";
import { walletStatsTable as wallets } from "../progress/tables";
import { GameError } from "../games/errors";
import type { SessionUser } from "../http/session";
import type { ProgressService } from "../progress/service";

/** Browsers' push services. Anything else is refused, so the API never posts to arbitrary URLs. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];
const MAX_DEVICES = 5;
/** Don't ping about titles more often than this, so a rank see-sawing around 3rd isn't spammy. */
const TITLE_QUIET_MS = 3 * 60 * 60_000;

export function isPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    !u.port &&
    PUSH_HOSTS.some((h) => h.test(u.hostname))
  );
}

export interface PushKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

type Sender = (
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
) => Promise<void>;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export class PushService {
  private readonly send: Sender | null;

  constructor(
    private readonly db: Db,
    private readonly progress: ProgressService,
    private readonly keys: PushKeys | null,
    sender?: Sender,
  ) {
    this.send =
      sender ??
      (keys
        ? async (sub, payload) => {
            // Loaded on first send: most instances never send a push, so don't pay for the crypto deps up front.
            const { default: webpush } = await import("web-push");
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              payload,
              {
                vapidDetails: {
                  subject: keys.subject,
                  publicKey: keys.publicKey,
                  privateKey: keys.privateKey,
                },
                TTL: 6 * 60 * 60,
                timeout: 10_000,
              },
            );
          }
        : null);
  }

  config(): PushConfigDTO {
    return {
      enabled: this.send !== null,
      publicKey: this.keys?.publicKey ?? null,
    };
  }

  async prefs(userId: string, endpoint: string): Promise<PushPrefsDTO | null> {
    const [row] = await this.db
      .select({
        daily: pushSubscriptions.daily,
        titles: pushSubscriptions.titles,
      })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.endpoint, endpoint),
        ),
      );
    return row ?? null;
  }

  async subscribe(
    user: SessionUser,
    input: {
      endpoint: string;
      p256dh: string;
      auth: string;
      daily: boolean;
      titles: boolean;
    },
  ): Promise<void> {
    if (user.isAnonymous)
      throw new GameError(
        403,
        "SIGN_UP_REQUIRED",
        "Create a free account to get notifications",
      );
    if (!this.send)
      throw new GameError(
        404,
        "PUSH_DISABLED",
        "Notifications aren't available",
      );
    if (!isPushEndpoint(input.endpoint))
      throw new GameError(400, "INVALID_ENDPOINT", "Unsupported push service");
    await this.db.transaction(async (tx) => {
      // Another account signed in on this device takes it over.
      await tx
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint));
      const [n] = await tx
        .select({ n: count() })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, user.id));
      if (n!.n >= MAX_DEVICES)
        throw new GameError(
          409,
          "TOO_MANY_DEVICES",
          `Notifications are on for ${MAX_DEVICES} devices already`,
        );
      await tx.insert(pushSubscriptions).values({ userId: user.id, ...input });
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.endpoint, endpoint),
        ),
      );
  }

  private async deliver(
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    p: PushPayload,
  ): Promise<boolean> {
    try {
      await this.send!(sub, JSON.stringify(p));
      return true;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Gone for good: the browser dropped the subscription.
      if (status === 404 || status === 410)
        await this.db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, sub.id));
      return false;
    }
  }

  /** Devices whose owner's daily claim has unlocked since we last said so. */
  async notifyDaily(now = new Date()): Promise<number> {
    if (!this.send) return 0;
    const due = await this.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        unlock: wallets.nextDailyClaimAt,
      })
      .from(pushSubscriptions)
      .innerJoin(wallets, eq(wallets.userId, pushSubscriptions.userId))
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(
        and(
          eq(pushSubscriptions.daily, true),
          isNull(users.suspendedAt),
          isNotNull(wallets.nextDailyClaimAt),
          lte(wallets.nextDailyClaimAt, now),
          or(
            isNull(pushSubscriptions.dailyNotifiedFor),
            lt(pushSubscriptions.dailyNotifiedFor, wallets.nextDailyClaimAt),
          ),
        ),
      )
      .limit(500);
    let sent = 0;
    for (const s of due) {
      // Mark first: a failed send shouldn't retry every run.
      await this.db
        .update(pushSubscriptions)
        .set({ dailyNotifiedFor: s.unlock })
        .where(eq(pushSubscriptions.id, s.id));
      if (
        await this.deliver(s, {
          title: "Your daily chips are ready",
          body: "Tap to claim them.",
          url: "/",
          tag: "daily",
        })
      )
        sent++;
    }
    return sent;
  }

  /** Devices whose owner gained or lost a weekly title since we last said so. */
  async notifyTitles(now = new Date()): Promise<number> {
    if (!this.send) return 0;
    const subs = await this.db
      .select({
        id: pushSubscriptions.id,
        userId: pushSubscriptions.userId,
        name: users.name,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        lastTitle: pushSubscriptions.lastTitle,
        notifiedAt: pushSubscriptions.titleNotifiedAt,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(and(eq(pushSubscriptions.titles, true), isNull(users.suspendedAt)))
      .limit(2000);
    if (!subs.length) return 0;
    const tags = await this.progress.tags(
      subs.map((s) => ({ userId: s.userId, name: s.name })),
    );
    let sent = 0;
    for (const s of subs) {
      const title = tags.get(s.userId)?.title ?? null;
      if (title === s.lastTitle) continue;
      if (
        s.notifiedAt &&
        now.getTime() - s.notifiedAt.getTime() < TITLE_QUIET_MS
      )
        continue;
      await this.db
        .update(pushSubscriptions)
        .set({ lastTitle: title, titleNotifiedAt: now })
        .where(eq(pushSubscriptions.id, s.id));
      const payload: PushPayload = title
        ? title === "Safety Stores"
          ? {
              title: "You're this week's Safety Stores",
              body: "Biggest loss of the week. Time for a comeback?",
              url: "/leaderboard",
              tag: "title",
            }
          : {
              title: `You're now ${title}!`,
              body: "You climbed into this week's top 3.",
              url: "/leaderboard",
              tag: "title",
            }
        : {
            title: `You lost ${s.lastTitle}`,
            body: "Someone overtook you this week. Win it back.",
            url: "/leaderboard",
            tag: "title",
          };
      if (await this.deliver(s, payload)) sent++;
    }
    return sent;
  }
}
