import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LAB_REWARDS } from "@snakeland/shared";
import { LCG_M, mulberry32 } from "../src/lab/flags";
import { LabService } from "../src/lab/service";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
const wallet = new WalletService(db);
const lab = new LabService(db, wallet, "x".repeat(48));
afterAll(() => pool.end());
beforeAll(() => lab.ensureStarterPack());

const player = async (anonymous = false) => {
  const id = await createUser(db, { anonymous });
  await wallet.apply({ userId: id, amount: 1000, type: "signup_bonus" });
  return { id, name: "Test", email: `${id}@example.test`, isAnonymous: anonymous };
};
const text = async (u: Awaited<ReturnType<typeof player>>, slug: string) => (await lab.file(u, slug, 0)).content.trim();

const unhex = (h: string) => Buffer.from(h, "hex");
const modpow = (b: bigint, e: bigint, m: bigint) => {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
};

/** A solver for every starter challenge: proves each is solvable from what the player sees. */
const solvers: Record<string, (u: Awaited<ReturnType<typeof player>>) => Promise<string>> = {
  encoded: async (u) => Buffer.from(await text(u, "encoded"), "base64").toString(),
  "snake-cipher": async (u) => {
    const c = await text(u, "snake-cipher");
    const shift = (c.charCodeAt(0) - "s".charCodeAt(0) + 26) % 26;
    return c.replace(/[a-z]/g, (ch) => String.fromCharCode(((ch.charCodeAt(0) - 97 - shift + 26) % 26) + 97));
  },
  "leaky-header": async (u) => lab.endpointFlag(u, "leaky-header"),
  "one-byte": async (u) => {
    const c = unhex(await text(u, "one-byte"));
    const key = c[0]! ^ "s".charCodeAt(0);
    return Buffer.from(c.map((b) => b ^ key)).toString();
  },
  "night-shift": async (u) => {
    const log = await text(u, "night-shift");
    const parts = [...log.matchAll(/px\.gif\?id=(\d+)&d=([0-9a-f]+)/g)].map((m) => [Number(m[1]), m[2]!] as const);
    return unhex(parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join("")).toString();
  },
  "vip-room": async (u) => lab.endpointFlag(u, "vip-room"),
  "weak-dealer": async (u) => {
    const lines = (await text(u, "weak-dealer")).split("\n").filter((l) => !l.startsWith("#"));
    const xs = lines.slice(0, 6).map(BigInt);
    const m = BigInt(LCG_M);
    const inv = (v: bigint) => modpow(((v % m) + m) % m, m - 2n, m);
    const a = ((((xs[2]! - xs[1]!) % m) + m) % m) * inv(xs[1]! - xs[0]!) % m;
    const c = (((xs[1]! - a * xs[0]!) % m) + m) % m;
    let x = xs[5]!;
    return Buffer.from(unhex(lines[6]!).map((b) => b ^ Number((x = (a * x + c) % m) & 0xffn))).toString();
  },
  "sealed-vault": async (u) => {
    const src = await text(u, "sealed-vault");
    const start = Date.parse(src.match(/between (\S+) and/)![1]!) / 1000;
    const cipher = unhex(src.match(/ciphertext = "([0-9a-f]+)"/)![1]!);
    for (let s = start; s < start + 3600; s++) {
      const r = mulberry32(s);
      const out = Buffer.from(cipher.map((b) => b ^ Math.floor(r() * 256))).toString("latin1");
      if (out.startsWith("snk{")) return out;
    }
    throw new Error("no seed");
  },
};

describe("The Lab", () => {
  it("every starter challenge is solvable, pays once, and flags are per player", async () => {
    const u = await player();
    const other = await player();
    const list = await lab.list(u);
    expect(list.canPlay).toBe(true);
    const starters = list.challenges.filter((c) => c.slug in solvers);
    expect(starters.map((c) => c.slug)).toEqual(Object.keys(solvers));

    const start = (await wallet.getWallet(u.id)).balance;
    let expected = start;
    for (const c of starters) {
      const flag = await solvers[c.slug]!(u);
      expect(flag).toMatch(/^snk\{/);
      // Someone else's flag doesn't work for you.
      expect((await lab.submit(other, c.slug, flag)).correct).toBe(false);
      const first = await lab.submit(u, c.slug, flag);
      expected += LAB_REWARDS[c.difficulty];
      expect(first).toMatchObject({ correct: true, reward: LAB_REWARDS[c.difficulty], balance: expected });
      expect(await lab.submit(u, c.slug, flag)).toMatchObject({ correct: true, reward: null, alreadySolved: true });
    }
    const after = await lab.list(u);
    expect(after.challenges.filter((c) => c.slug in solvers).every((c) => c.solved)).toBe(true);
    expect(after.earned).toBe(expected - start);
    expect(await wallet.ledgerSum(u.id)).toBe((await wallet.getWallet(u.id)).balance);
    // Lab chips aren't game profit.
    const profit = await db.execute<{ p: string }>(`select lifetime_profit as p from wallets where user_id = '${u.id}'`);
    expect(Number(profit.rows[0]!.p)).toBe(0);
  });

  it("wrong flags fail, guests can look but not play", async () => {
    const u = await player();
    expect((await lab.submit(u, "encoded", "snk{nope}")).correct).toBe(false);
    expect((await lab.submit(u, "encoded", "not a flag")).correct).toBe(false);
    const g = await player(true);
    expect((await lab.list(g)).canPlay).toBe(false);
    await expect(lab.file(g, "encoded", 0)).rejects.toMatchObject({ code: "SIGN_UP_REQUIRED" });
    await expect(lab.submit(g, "encoded", "snk{x}")).rejects.toMatchObject({ code: "SIGN_UP_REQUIRED" });
    await expect(lab.file(u, "nope", 0)).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  });

  it("admin static challenges store only a hash, and drafts are hidden", async () => {
    const u = await player();
    const slug = `static-${Date.now()}`;
    const id = await lab.create({
      slug,
      title: "Static",
      category: "web",
      difficulty: "easy",
      description: "d",
      hint: null,
      reward: 500,
      flagMode: "static",
      flag: "snk{same_for_all}",
      files: [],
      published: false,
      sortOrder: 999,
    });
    expect((await lab.list(u)).challenges.some((c) => c.slug === slug)).toBe(false);
    const admin = (await lab.adminList()).find((c) => c.id === id)!;
    expect(admin.hasStaticFlag).toBe(true);
    expect(JSON.stringify(admin)).not.toContain("same_for_all");
    await lab.update(id, { ...admin, flag: undefined, published: true });
    expect((await lab.submit(u, slug, "snk{same_for_all}")).reward).toBe(500);
    await expect(lab.remove(id)).rejects.toMatchObject({ code: "HAS_SOLVES" });
  });
});
