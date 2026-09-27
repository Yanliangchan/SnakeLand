import { createCipheriv } from "node:crypto";

/**
 * The ECB oracle: AES-128-ECB( attackerData || flag , key ), hex.
 * ECB encrypts each 16-byte block independently, which is exactly the weakness
 * the byte-at-a-time challenge exploits. The key is per-player and never sent.
 */
export function ecbOracle(flag: string, key: Buffer, data: Buffer): string {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const input = Buffer.concat([data, Buffer.from(flag, "utf8")]);
  return Buffer.concat([cipher.update(input), cipher.final()]).toString("hex");
}
