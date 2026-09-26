import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Provably-fair primitives shared by the server (which generates outcomes)
 * and the browser (which lets players verify them after the reveal).
 *
 * Scheme: before a round the server commits to sha256(serverSeed). Outcomes
 * are derived from HMAC-SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:${round}`),
 * consuming 4 bytes per float. After the round the server seed is revealed
 * and anyone can recompute both the commit and every outcome.
 */

const SEED_HEX = /^[0-9a-f]{64}$/;

export function isServerSeed(value: string): boolean {
  return SEED_HEX.test(value);
}

/** The public commitment shown to the player before the round. */
export function hashServerSeed(serverSeed: string): string {
  if (!isServerSeed(serverSeed)) throw new TypeError("server seed must be 32 bytes of lowercase hex");
  return bytesToHex(sha256(hexToBytes(serverSeed)));
}

export function verifyCommit(serverSeed: string, commit: string): boolean {
  return isServerSeed(serverSeed) && hashServerSeed(serverSeed) === commit.toLowerCase();
}

/** Deterministic stream of floats in [0, 1). */
export function fairFloats(serverSeed: string, clientSeed: string, nonce: number, count: number): number[] {
  if (!isServerSeed(serverSeed)) throw new TypeError("invalid server seed");
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new RangeError("invalid nonce");
  if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) throw new RangeError("invalid count");

  const key = hexToBytes(serverSeed);
  const out: number[] = [];
  for (let round = 0; out.length < count; round++) {
    const digest = hmac(sha256, key, utf8ToBytes(`${clientSeed}:${nonce}:${round}`));
    for (let i = 0; i + 4 <= digest.length && out.length < count; i += 4) {
      // Four bytes -> a float in [0, 1) with 32 bits of precision.
      let f = 0;
      for (let b = 0; b < 4; b++) f += digest[i + b]! / 256 ** (b + 1);
      out.push(f);
    }
  }
  return out;
}

/** Uniform integer in [0, max). */
export function floatToInt(float: number, max: number): number {
  return Math.floor(float * max);
}

/** Fisher–Yates shuffle driven by fair floats (used for shoes and mine layouts). */
export function fairShuffle<T>(items: readonly T[], floats: readonly number[]): T[] {
  if (floats.length < items.length - 1) throw new RangeError("not enough floats to shuffle");
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = floatToInt(floats[arr.length - 1 - i]!, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Rebuild a shuffled shoe from its revealed seeds (same algorithm the server uses). */
export function shuffleShoe<T>(ordered: readonly T[], serverSeed: string, clientSeed: string): T[] {
  return fairShuffle(ordered, fairFloats(serverSeed, clientSeed, 0, Math.max(0, ordered.length - 1)));
}
