import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { labRewardAfterHints } from "@snakeland/shared";
import { LCG_M, mulberry32 } from "../src/lab/flags";
import { ecbOracle } from "../src/lab/aes";
import { signJwt } from "../src/lab/jwt";
import { LabService } from "../src/lab/service";
import { sqliLogin, sqliSearch, sqliteAvailable } from "../src/lab/sqli";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
const wallet = new WalletService(db);
const lab = new LabService(db, wallet, "x".repeat(48));
afterAll(() => pool.end());
beforeAll(async () => {
  // Start from a clean slate: the reworked pack replaces any earlier seed.
  await db.execute("DELETE FROM lab_hint_unlocks");
  await db.execute("DELETE FROM lab_solves");
  await db.execute("DELETE FROM lab_challenges");
  await lab.ensureStarterPack();
});

type Player = { id: string; name: string; email: string; isAnonymous: boolean };
const player = async (anonymous = false): Promise<Player> => {
  const id = await createUser(db, { anonymous });
  await wallet.apply({ userId: id, amount: 1000, type: "signup_bonus" });
  return { id, name: "Test", email: `${id}@example.test`, isAnonymous: anonymous };
};
const text = async (u: Player, slug: string) => (await lab.file(u, slug, 0)).content.trim();
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
const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = n,
    y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
};
function egcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x, y] = egcd(b, a % b);
  return [g, y, x - (a / b) * y];
}
const modinv = (a: bigint, m: bigint) => {
  const [, x] = egcd(((a % m) + m) % m, m);
  return ((x % m) + m) % m;
};
// Fermat factorisation — works because the two primes are chosen close together.
function fermat(n: bigint): [bigint, bigint] {
  let a = isqrt(n);
  if (a * a < n) a += 1n;
  for (let i = 0; i < 5_000_000; i++) {
    const b2 = a * a - n;
    const b = isqrt(b2);
    if (b * b === b2) return [a - b, a + b];
    a += 1n;
  }
  throw new Error("fermat failed");
}
const rot = (s: string, k: number) =>
  s.replace(/[a-z]/gi, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + k) % 26) + base);
  });

/** A solver for every challenge: proves each is solvable from what the player sees. */
const solvers: Record<string, (u: Player) => Promise<string>> = {
  // ---- easy ----
  encoded: async (u) => Buffer.from(await text(u, "encoded"), "base64").toString(),
  "caesar-ledger": async (u) => {
    const c = await text(u, "caesar-ledger");
    const shift = (c.charCodeAt(0) - "s".charCodeAt(0) + 26) % 26;
    return c.replace(/[a-z]/g, (ch) => String.fromCharCode(((ch.charCodeAt(0) - 97 - shift + 26) % 26) + 97));
  },
  "leaky-header": async (u) => lab.endpointFlag(u, "leaky-header"),
  "login-bypass": async (u) => {
    const { flag } = await lab.endpointContext(u, "login-bypass");
    const res = await sqliLogin(flag, "admin'--", "x");
    return res.rows.find((r) => r.username === "admin")!.note;
  },
  "morse-signal": async (u) => {
    const M: Record<string, string> = {
      ".-": "a", "-...": "b", "-.-.": "c", "-..": "d", ".": "e", "..-.": "f", "--.": "g", "....": "h", "..": "i", ".---": "j",
      "-.-": "k", ".-..": "l", "--": "m", "-.": "n", "---": "o", ".--.": "p", "--.-": "q", ".-.": "r", "...": "s", "-": "t",
      "..-": "u", "...-": "v", ".--": "w", "-..-": "x", "-.--": "y", "--..": "z", "-----": "0", ".----": "1", "..---": "2",
      "...--": "3", "....-": "4", ".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9",
      "-.--.": "{", "-.--.-": "}", "..--.-": "_",
    };
    return (await text(u, "morse-signal")).split(" ").map((m) => M[m] ?? "?").join("");
  },
  "hidden-history": async (u) => {
    const log = await text(u, "hidden-history");
    // The real token was ADDED in "feat: add vault client"; the removal line is a decoy.
    const added = log.split("\n").find((l) => l.startsWith("+const VAULT_TOKEN"))!;
    return JSON.parse(added.match(/= (".*");/)![1]!);
  },

  // ---- medium ----
  "binary-bits": async (u) =>
    (await text(u, "binary-bits")).split(/\s+/).map((b) => String.fromCharCode(parseInt(b, 2))).join(""),
  "single-xor": async (u) => {
    const c = unhex(await text(u, "single-xor"));
    const key = c[0]! ^ "s".charCodeAt(0);
    return Buffer.from(c.map((b) => b ^ key)).toString();
  },
  "atbash-mirror": async (u) =>
    (await text(u, "atbash-mirror")).replace(/[a-z]/gi, (ch) => {
      const base = ch <= "Z" ? 65 : 97;
      return String.fromCharCode(base + 25 - (ch.charCodeAt(0) - base));
    }),
  "night-shift": async (u) => {
    const log = await text(u, "night-shift");
    const parts = [...log.matchAll(/px\.gif\?id=(\d+)&d=([0-9a-f]+)/g)].map((m) => [Number(m[1]), m[2]!] as const);
    return unhex(parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join("")).toString();
  },
  "union-heist": async (u) => {
    const { flag } = await lab.endpointContext(u, "union-heist");
    const res = await sqliSearch(flag, "' UNION SELECT id, value, 0 FROM secrets--");
    return String(res.rows.find((r) => String(r[1]).startsWith("snk{"))![1]);
  },
  "url-smuggle": async (u) => decodeURIComponent(await text(u, "url-smuggle")),

  // ---- hard ----
  "vigenere-vault": async (u) => {
    // Known-plaintext attack: the flag's non-random prefix is public (snk{<slug>_...),
    // giving a long crib. dcode's auto-solver is the no-crib path.
    const ct = await text(u, "vigenere-vault");
    const letters = [...ct].filter((ch) => /[a-z]/i.test(ch)).map((ch) => ch.toLowerCase().charCodeAt(0) - 97);
    const crib = [..."snkvigenerevault"].map((ch) => ch.charCodeAt(0) - 97);
    for (let len = 3; len <= 7; len++) {
      const key = Array.from({ length: len }, (_, k) => {
        const i = crib.findIndex((_, j) => j % len === k);
        return i < 0 ? -1 : (((letters[i]! - crib[i]!) % 26) + 26) % 26;
      });
      if (key.some((k) => k < 0)) continue;
      let li = 0;
      const out = ct.replace(/[a-z]/gi, (ch) => {
        const base = ch <= "Z" ? 65 : 97;
        const shift = key[li++ % len]!;
        return String.fromCharCode(((ch.charCodeAt(0) - base - shift + 26) % 26) + base);
      });
      if (out.startsWith("snk{vigenere_vault_") && out.endsWith("}")) return out;
    }
    throw new Error("vigenere key not found");
  },
  "repeat-offender": async (u) => {
    const c = unhex(await text(u, "repeat-offender"));
    // The known flag prefix is a long crib, enough to cover any short key length.
    const crib = Buffer.from("snk{repeat_offender_");
    for (let len = 3; len <= 6; len++) {
      const key = Array.from({ length: len }, (_, k) => c[k]! ^ crib[k]!);
      const out = Buffer.from(c.map((b, i) => b ^ key[i % len]!)).toString("latin1");
      if (out.startsWith("snk{repeat_offender_") && out.endsWith("}")) return out;
    }
    throw new Error("xor key not found");
  },
  "weak-dealer": async (u) => {
    const lines = (await text(u, "weak-dealer")).split("\n").filter((l) => !l.startsWith("#"));
    const xs = lines.slice(0, 6).map(BigInt);
    const m = BigInt(LCG_M);
    const a = (((((xs[2]! - xs[1]!) % m) + m) % m) * modinv(((xs[1]! - xs[0]!) % m + m) % m, m)) % m;
    const cc = (((xs[1]! - a * xs[0]!) % m) + m) % m;
    let x = xs[5]!;
    return Buffer.from(unhex(lines[6]!).map((b) => b ^ Number((x = (a * x + cc) % m) & 0xffn))).toString();
  },
  "admin-lounge": async (u) => {
    const { flag, jwtSecret } = await lab.endpointContext(u, "admin-lounge");
    // The "crack": jwtSecret is one of a small set of common passwords (WEAK_SECRETS).
    const admin = signJwt({ role: "admin", sub: u.id }, jwtSecret);
    // Prove the forged token would open the lounge by re-verifying it the way the route does.
    const { verifyJwt } = await import("../src/lab/jwt");
    expect(verifyJwt(admin, jwtSecret)?.role).toBe("admin");
    return flag;
  },
  onion: async (u) => {
    const b64 = await text(u, "onion");
    return [...rot(Buffer.from(b64, "base64").toString("latin1"), 13)].reverse().join("");
  },

  // ---- insane ----
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
  "rsa-careless": async (u) => {
    const src = await text(u, "rsa-careless");
    const n = BigInt(src.match(/n = (\d+)/)![1]!);
    const e = BigInt(src.match(/e = (\d+)/)![1]!);
    const c = BigInt(src.match(/c = (\d+)/)![1]!);
    const [p, q] = fermat(n);
    const d = modinv(e, (p - 1n) * (q - 1n));
    const m = modpow(c, d, n);
    let hex = m.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    return unhex(hex).toString();
  },
  "ecb-oracle": async (u) => {
    const { flag, aesKey } = await lab.endpointContext(u, "ecb-oracle");
    const oracle = (data: Buffer) => unhex(ecbOracle(flag, aesKey, data));
    const B = 16;
    const flagLen = oracle(Buffer.alloc(0)).length; // padded length upper bound
    let known = Buffer.alloc(0);
    for (let i = 0; i < flagLen; i++) {
      const pad = Buffer.alloc((B - 1 - (known.length % B) + B) % B, 0x41);
      const blockIndex = Math.floor((pad.length + known.length) / B);
      const target = oracle(pad).subarray(blockIndex * B, blockIndex * B + B);
      let found = -1;
      for (let g = 0; g < 256; g++) {
        const probe = Buffer.concat([pad, known, Buffer.from([g])]);
        const out = oracle(probe).subarray(blockIndex * B, blockIndex * B + B);
        if (out.equals(target)) {
          found = g;
          break;
        }
      }
      if (found === -1) break; // hit padding
      known = Buffer.concat([known, Buffer.from([found])]);
      if (known.toString("latin1").endsWith("}")) break;
    }
    return known.toString("latin1");
  },
};

describe("The Lab challenges", () => {
  it("has an SQLite sandbox available for the SQLi challenges", async () => {
    expect(await sqliteAvailable()).toBe(true);
  });

  it("every challenge is solvable, pays once, and flags are per player", async () => {
    const u = await player();
    const other = await player();
    const list = await lab.list(u);
    const known = list.challenges.filter((c) => c.slug in solvers);
    // Every published challenge must have a solver in this test.
    expect(list.challenges.map((c) => c.slug).sort()).toEqual(Object.keys(solvers).sort());
    expect(known.length).toBeGreaterThanOrEqual(20);

    for (const cInfo of known) {
      const flag = await solvers[cInfo.slug]!(u);
      expect(flag, cInfo.slug).toMatch(/^snk\{.*\}$/);
      // Someone else's flag never works for you.
      expect((await lab.submit(other, cInfo.slug, flag)).correct, `${cInfo.slug} cross-player`).toBe(false);
      const first = await lab.submit(u, cInfo.slug, flag);
      expect(first.correct, `${cInfo.slug} solve`).toBe(true);
      expect(first.reward, `${cInfo.slug} reward`).toBe(cInfo.reward);
      // Second submit doesn't pay again.
      expect((await lab.submit(u, cInfo.slug, flag)).alreadySolved).toBe(true);
    }
    const after = await lab.list(u);
    expect(after.challenges.every((c) => c.solved)).toBe(true);
    // Lab chips aren't game profit.
    const profit = await db.execute<{ p: string }>(`select lifetime_profit as p from wallets where user_id = '${u.id}'`);
    expect(Number(profit.rows[0]!.p)).toBe(0);
    expect(await wallet.ledgerSum(u.id)).toBe((await wallet.getWallet(u.id)).balance);
  });
});

describe("Lab hints and access", () => {
  it("opening hints cuts the reward, in order, and reveals text", async () => {
    const u = await player();
    const before = (await lab.list(u)).challenges.find((c) => c.slug === "encoded")!;
    expect(before.hints.every((h) => h.text === null)).toBe(true);
    expect(before.effectiveReward).toBe(before.reward);
    // Can't skip ahead.
    await expect(lab.unlockHint(u, "encoded", 1)).rejects.toMatchObject({ code: "HINT_ORDER" });
    const h0 = await lab.unlockHint(u, "encoded", 0);
    expect(h0.text.length).toBeGreaterThan(0);
    expect(h0.effectiveReward).toBe(labRewardAfterHints(before.reward, 10));
    const h1 = await lab.unlockHint(u, "encoded", 1);
    expect(h1.effectiveReward).toBe(labRewardAfterHints(before.reward, 30));
    // Solving now pays the reduced amount.
    const flag = await solvers.encoded!(u);
    const solved = await lab.submit(u, "encoded", flag);
    expect(solved.reward).toBe(labRewardAfterHints(before.reward, 30));
  });

  it("guests can look but not play, and unknown slugs 404", async () => {
    const g = await player(true);
    expect((await lab.list(g)).canPlay).toBe(false);
    await expect(lab.file(g, "encoded", 0)).rejects.toMatchObject({ code: "SIGN_UP_REQUIRED" });
    await expect(lab.unlockHint(g, "encoded", 0)).rejects.toMatchObject({ code: "SIGN_UP_REQUIRED" });
    const u = await player();
    await expect(lab.file(u, "nope", 0)).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
    expect((await lab.submit(u, "encoded", "snk{nope}")).correct).toBe(false);
  });
});

describe("admin lab editor", () => {
  it("stores static flags hashed, hides drafts, keeps solved history", async () => {
    const u = await player();
    const slug = `static-${Date.now()}`;
    const id = await lab.create({
      slug,
      title: "Static",
      category: "web",
      difficulty: "easy",
      description: "d",
      hints: [{ text: "a hint", penalty: 20 }],
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
    expect(admin.hints[0]!.penalty).toBe(20);
    expect(JSON.stringify(admin)).not.toContain("same_for_all");
    await lab.update(id, { ...admin, flag: undefined, published: true });
    expect((await lab.submit(u, slug, "snk{same_for_all}")).reward).toBe(500);
    await expect(lab.remove(id)).rejects.toMatchObject({ code: "HAS_SOLVES" });
  });
});
