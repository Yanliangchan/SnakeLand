import {
  LAB_REWARDS,
  type LabCategory,
  type LabDifficulty,
} from "@snakeland/shared";

export interface StarterChallenge {
  slug: string;
  title: string;
  category: LabCategory;
  difficulty: LabDifficulty;
  description: string;
  hint: string;
  files: { name: string; content: string }[];
}

/**
 * The Lab's opening set. Every one is per-player: files are templates filled
 * with the player's own flag, so answers can't be shared. Seeded once; after
 * that the admin editor owns them.
 */
export const STARTER_PACK: StarterChallenge[] = [
  {
    slug: "encoded",
    title: "Encoded",
    category: "crypto",
    difficulty: "easy",
    description:
      "A note slipped under the casino door. It isn't encrypted, just encoded. Decode it to find your flag.\n\nFlags always look like snk{...}.",
    hint: "The alphabet is A–Z, a–z, 0–9, + and /, and it sometimes ends in =.",
    files: [{ name: "note.txt", content: "{{FLAG_B64}}\n" }],
  },
  {
    slug: "snake-cipher",
    title: "Snake Cipher",
    category: "crypto",
    difficulty: "easy",
    description:
      "The pit boss swears nobody can read his ledger. Every letter is shifted along the alphabet by the same secret amount. Digits and symbols are left alone.",
    hint: "You already know the flag starts with snk. How far is s from the first letter?",
    files: [{ name: "ledger.txt", content: "{{FLAG_CAESAR}}\n" }],
  },
  {
    slug: "leaky-header",
    title: "Leaky Header",
    category: "web",
    difficulty: "easy",
    description:
      "A developer left debugging switched on in the status endpoint. The page itself looks harmless.\n\nVisit /v1/lab/c/status while signed in.",
    hint: "Open your browser's developer tools and look at the Network tab. The body isn't the only part of a response.",
    files: [],
  },
  {
    slug: "one-byte",
    title: "One Byte Away",
    category: "crypto",
    difficulty: "medium",
    description:
      "The flag was XORed with a single secret byte and written out as hex. With only 256 possible keys, how hard can it be?",
    hint: "XOR the first byte of the ciphertext with 's' (0x73) to get the key.",
    files: [{ name: "cipher.hex", content: "{{FLAG_XOR}}\n" }],
  },
  {
    slug: "night-shift",
    title: "Night Shift",
    category: "forensics",
    difficulty: "medium",
    description:
      "Something odd happened on the web server overnight. Someone probed for secrets, then smuggled data out a few characters at a time. Rebuild what they took.",
    hint: "Filter to one IP, sort the tiny image requests by id, join the d= values and decode the hex.",
    files: [{ name: "access.log", content: "{{ACCESS_LOG}}\n" }],
  },
  {
    slug: "vip-room",
    title: "VIP Room",
    category: "web",
    difficulty: "medium",
    description:
      "The VIP room at /v1/lab/c/vip only lets admins in. It decides who you are from a cookie it hands you on your first visit. Trust issues, much?",
    hint: "The cookie is base64url-encoded JSON, and nothing signs it.",
    files: [],
  },
  {
    slug: "weak-dealer",
    title: "Weak Dealer",
    category: "casino",
    difficulty: "hard",
    description:
      "A rival casino shuffles with a linear congruential generator and keeps the multiplier and increment secret. You've watched six outputs. Predict the rest, and the flag falls out.",
    hint: "With a prime modulus, a = (x3 − x2) · (x2 − x1)⁻¹ mod m. Then c = x2 − a·x1 mod m.",
    files: [{ name: "shuffler.txt", content: "{{LCG}}\n" }],
  },
  {
    slug: "sealed-vault",
    title: "Sealed Vault",
    category: "casino",
    difficulty: "insane",
    description:
      "The vault's key stream came from a seeded random number generator, and the seed was the time the flag was sealed. You know the hour. That's only 3,600 seconds to try…",
    hint: "Try every seed in the hour and keep the one whose output starts with snk{.",
    files: [{ name: "vault.js", content: "{{TIMESEED}}\n" }],
  },
];

export const starterReward = (d: LabDifficulty) => LAB_REWARDS[d];
