import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { pushSubscriptions, wallets } from "../src/db/schema";
import { ProgressService } from "../src/progress/service";
import { PushService, isPushEndpoint } from "../src/push/service";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());
const wallet = new WalletService(db);
const keys = { publicKey: "p", privateKey: "k", subject: "mailto:a@b.c" };
const p256dh = "B".repeat(87);
const auth = "a".repeat(22);

describe("push endpoints", () => {
  it("only accepts real browser push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
  });
});

describe("PushService", () => {
  it("pings once per daily unlock, drops dead subscriptions, and refuses guests", async () => {
    const sent: Array<{ endpoint: string; payload: string }> = [];
    let fail = 0;
    const push = new PushService(db, new ProgressService(db, wallet), keys, async (sub, payload) => {
      if (fail) throw Object.assign(new Error("gone"), { statusCode: fail });
      sent.push({ endpoint: sub.endpoint, payload });
    });
    const id = await createUser(db);
    await wallet.apply({ userId: id, amount: 1000, type: "signup_bonus" });
    const user = { id, name: "P", email: "", isAnonymous: false };
    const endpoint = `https://fcm.googleapis.com/fcm/send/${id}`;
    await push.subscribe(user, { endpoint, p256dh, auth, daily: true, titles: false });
    expect(await push.prefs(id, endpoint)).toEqual({ daily: true, titles: false });

    const unlock = new Date(Date.now() - 60_000);
    await db.update(wallets).set({ nextDailyClaimAt: unlock }).where(eq(wallets.userId, id));
    await push.notifyDaily();
    await push.notifyDaily();
    const mine = sent.filter((s) => s.endpoint === endpoint);
    expect(mine).toHaveLength(1);
    expect(JSON.parse(mine[0]!.payload)).toMatchObject({ title: "Your daily chips are ready", url: "/" });

    // Next unlock: the browser has dropped the subscription, so it's removed.
    await db.update(wallets).set({ nextDailyClaimAt: new Date(Date.now() - 1000) }).where(eq(wallets.userId, id));
    fail = 410;
    await push.notifyDaily();
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))).toHaveLength(0);

    const guest = { id: await createUser(db, { anonymous: true }), name: "G", email: "", isAnonymous: true };
    await expect(push.subscribe(guest, { endpoint: `${endpoint}g`, p256dh, auth, daily: true, titles: true })).rejects.toMatchObject({
      code: "SIGN_UP_REQUIRED",
    });
    await expect(
      push.subscribe(user, { endpoint: "https://evil.example/x", p256dh, auth, daily: true, titles: true }),
    ).rejects.toMatchObject({ code: "INVALID_ENDPOINT" });
  });

  it("is off without keys", async () => {
    const push = new PushService(db, new ProgressService(db, wallet), null);
    expect(push.config()).toEqual({ enabled: false, publicKey: null });
    expect(await push.notifyDaily()).toBe(0);
  });
});
