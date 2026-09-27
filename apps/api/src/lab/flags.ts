import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Per-player flags and the puzzle material built from them. Everything is
 * derived from a server secret plus (user, challenge), so nothing needs to be
 * stored and one player's flag is useless to another.
 */

export const LCG_M = 2147483647; // 2^31 − 1, prime

export function labSecret(authSecret: string): Buffer {
  return createHmac("sha256", authSecret).update("snakeland-lab-v1").digest();
}

const hmacHex = (secret: Buffer, msg: string) =>
  createHmac("sha256", secret).update(msg).digest("hex");

export function playerFlag(
  secret: Buffer,
  userId: string,
  slug: string,
): string {
  return `snk{${slug.replace(/[^a-z0-9]+/gi, "_")}_${hmacHex(secret, `flag:${userId}:${slug}`).slice(0, 12)}}`;
}

export const hashFlag = (flag: string) =>
  createHash("sha256").update(flag.trim()).digest("hex");

/** Constant-time comparison through a hash, so length differences don't leak either. */
export function flagsMatch(submitted: string, expectedHash: string): boolean {
  const a = Buffer.from(hashFlag(submitted), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A small seeded PRNG (mulberry32). Also the one the Time Seed challenge uses. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngFor = (secret: Buffer, userId: string, slug: string, label: string) =>
  mulberry32(
    parseInt(hmacHex(secret, `${label}:${userId}:${slug}`).slice(0, 8), 16),
  );

const bytes = (s: string) => Buffer.from(s, "utf8");
const rot = (s: string, n: number) =>
  s.replace(/[a-z]/gi, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + n) % 26) + base);
  });

function lcgBlock(flag: string, rand: () => number): string {
  const a = 2 + Math.floor(rand() * (LCG_M - 3));
  const c = 1 + Math.floor(rand() * (LCG_M - 2));
  let x = BigInt(1 + Math.floor(rand() * (LCG_M - 2)));
  const next = () => (x = (BigInt(a) * x + BigInt(c)) % BigInt(LCG_M));
  const shown = Array.from({ length: 6 }, () => next().toString());
  const cipher = [...bytes(flag)]
    .map((b) => (b ^ Number(next() & 0xffn)).toString(16).padStart(2, "0"))
    .join("");
  return [
    "# The shuffler: x' = (a * x + c) mod 2147483647   (a and c are secret)",
    "# Six consecutive outputs:",
    ...shown,
    "# Every output after these had its lowest byte XORed with one byte of the flag:",
    cipher,
  ].join("\n");
}

function timeSeedBlock(flag: string, rand: () => number): string {
  const hourStart =
    Date.UTC(2026, 0, 1 + Math.floor(rand() * 180), Math.floor(rand() * 24)) /
    1000;
  const seed = hourStart + Math.floor(rand() * 3600);
  const r = mulberry32(seed);
  const cipher = [...bytes(flag)]
    .map((b) => (b ^ Math.floor(r() * 256)).toString(16).padStart(2, "0"))
    .join("");
  return [
    "// Our vault's key stream. The seed was the Unix time (in seconds) when the flag was sealed,",
    `// sometime between ${new Date(hourStart * 1000).toISOString()} and one hour later.`,
    "function mulberry32(seed) {",
    "  let a = seed >>> 0;",
    "  return () => {",
    "    a = (a + 0x6d2b79f5) >>> 0;",
    "    let t = a;",
    "    t = Math.imul(t ^ (t >>> 15), t | 1);",
    "    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);",
    "    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;",
    "  };",
    "}",
    "// ciphertext[i] = flag[i] ^ Math.floor(r() * 256), with r = mulberry32(seed)",
    `const ciphertext = "${cipher}";`,
  ].join("\n");
}

function accessLog(flag: string, rand: () => number): string {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const ips = Array.from(
    { length: 14 },
    () =>
      `${10 + Math.floor(rand() * 180)}.${Math.floor(rand() * 255)}.${Math.floor(rand() * 255)}.${1 + Math.floor(rand() * 250)}`,
  );
  const attacker = `203.0.113.${10 + Math.floor(rand() * 200)}`;
  const paths = [
    "/",
    "/lobby",
    "/play/mines",
    "/play/crash",
    "/leaderboard",
    "/wallet",
    "/v1/me",
    "/v1/progress",
    "/icons/icon-192.png",
    "/manifest.webmanifest",
  ];
  const agents = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15",
  ];
  const probes = [
    "/.env",
    "/wp-login.php",
    "/admin/config.bak",
    "/.git/HEAD",
    "/server-status",
    "/v1/admin/players?limit=1000",
  ];
  const hex = Buffer.from(flag, "utf8").toString("hex");
  const chunks = hex.match(/.{1,8}/g)!;
  const order = chunks.map((_, i) => i).sort(() => rand() - 0.5);

  type Line = { t: number; text: string };
  const lines: Line[] = [];
  let t = Date.UTC(2026, 5, 14, 2, 0, 0);
  const stamp = (ms: number) => {
    const d = new Date(ms);
    const mon = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][d.getUTCMonth()];
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}/${mon}/${d.getUTCFullYear()}:${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
  };
  const log = (
    ip: string,
    path: string,
    status: number,
    size: number,
    ua: string,
  ) =>
    lines.push({
      t,
      text: `${ip} - - [${stamp(t)}] "GET ${path} HTTP/1.1" ${status} ${size} "-" "${ua}"`,
    });

  for (let i = 0; i < 260; i++) {
    t += 1000 + Math.floor(rand() * 9000);
    log(
      pick(ips),
      pick(paths),
      rand() < 0.93 ? 200 : 304,
      200 + Math.floor(rand() * 40000),
      pick(agents),
    );
    if (i === 60)
      for (const p of probes) log(attacker, p, 404, 153, "curl/8.7.1");
    if (i > 90 && order.length && rand() < 0.22) {
      const id = order.shift()!;
      log(
        attacker,
        `/static/px.gif?id=${id}&d=${chunks[id]}`,
        200,
        43,
        "curl/8.7.1",
      );
    }
  }
  for (const id of order) {
    t += 3000;
    log(
      attacker,
      `/static/px.gif?id=${id}&d=${chunks[id]}`,
      200,
      43,
      "curl/8.7.1",
    );
  }
  return lines.map((l) => l.text).join("\n");
}

/** Fill a per-player template with that player's flag in its many disguises. */
export function renderTemplate(
  template: string,
  secret: Buffer,
  userId: string,
  slug: string,
): string {
  if (!template.includes("{{")) return template;
  const flag = playerFlag(secret, userId, slug);
  const r = rngFor(secret, userId, slug, "shape");
  const shift = 3 + Math.floor(r() * 20);
  const key = 1 + Math.floor(r() * 254);
  const fill: Record<string, () => string> = {
    "{{FLAG}}": () => flag,
    "{{FLAG_B64}}": () => Buffer.from(flag).toString("base64"),
    "{{FLAG_HEX}}": () => Buffer.from(flag).toString("hex"),
    "{{FLAG_ROT13}}": () => rot(flag, 13),
    "{{FLAG_REVERSED}}": () => [...flag].reverse().join(""),
    "{{FLAG_CAESAR}}": () => rot(flag, shift),
    "{{FLAG_XOR}}": () =>
      [...bytes(flag)]
        .map((b) => (b ^ key).toString(16).padStart(2, "0"))
        .join(""),
    "{{LCG}}": () => lcgBlock(flag, rngFor(secret, userId, slug, "lcg")),
    "{{TIMESEED}}": () =>
      timeSeedBlock(flag, rngFor(secret, userId, slug, "time")),
    "{{ACCESS_LOG}}": () =>
      accessLog(flag, rngFor(secret, userId, slug, "log")),
  };
  return template.replace(/\{\{[A-Z0-9_]+\}\}/g, (m) => fill[m]?.() ?? m);
}
