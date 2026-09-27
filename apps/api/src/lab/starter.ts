import { LAB_REWARDS, type LabCategory, type LabDifficulty, type LabHint } from "@snakeland/shared";

export interface StarterChallenge {
  slug: string;
  title: string;
  category: LabCategory;
  difficulty: LabDifficulty;
  description: string;
  hints: LabHint[];
  reward: number;
  files: { name: string; content: string }[];
}

/** Standard 3-tier penalties: a nudge, then the method + tool, then near-walkthrough. */
const H = (t1: string, t2: string, t3: string): LabHint[] => [
  { text: t1, penalty: 10 },
  { text: t2, penalty: 20 },
  { text: t3, penalty: 30 },
];

const c = (
  slug: string,
  title: string,
  category: LabCategory,
  difficulty: LabDifficulty,
  description: string,
  hints: LabHint[],
  files: { name: string; content: string }[] = [],
): StarterChallenge => ({ slug, title, category, difficulty, description, hints, reward: LAB_REWARDS[difficulty], files });

/**
 * The Lab's challenge set. Every challenge is per-player: files are templates
 * filled with that player's own flag, and the "vulnerable" endpoints only ever
 * reveal the caller's flag. Seeded once; after that the /admin editor owns them.
 * Most are built to be solved with free online tools (CyberChef, dcode.fr,
 * jwt.io, factordb / alpertron).
 */
export const STARTER_PACK: StarterChallenge[] = [
  // ---------------------------------------------------------------- easy
  c(
    "encoded",
    "Encoded",
    "crypto",
    "easy",
    "A note slipped under the casino door. It isn't encrypted, just encoded. Decode it to read your flag.\n\nEvery flag looks like snk{...}.",
    H(
      "The characters are only A–Z, a–z, 0–9, + and /, and it may end in =. That's a giveaway for one very common encoding.",
      "It's Base64. Paste it into CyberChef (gchq.github.io/CyberChef) and add a \"From Base64\" operation, or run `base64 -d` locally.",
      "In CyberChef: drag \"From Base64\" onto the recipe, paste note.txt into Input, and the flag appears in Output.",
    ),
    [{ name: "note.txt", content: "{{FLAG_B64}}\n" }],
  ),
  c(
    "caesar-ledger",
    "Caesar's Ledger",
    "crypto",
    "easy",
    "The pit boss keeps his ledger in a cipher where every letter is shifted along the alphabet by the same secret amount. Digits and symbols are left alone.",
    H(
      "You already know the plaintext starts with \"snk\". Compare it to the first letters of the ciphertext.",
      "It's a Caesar shift. dcode.fr's \"Caesar Cipher\" tool brute-forces all 25 shifts at once, or use CyberChef's \"ROT13 Brute Force\".",
      "Find the shift that turns the first three letters back into \"snk\", then apply that shift to the whole line.",
    ),
    [{ name: "ledger.txt", content: "{{FLAG_CAESAR}}\n" }],
  ),
  c(
    "leaky-header",
    "Leaky Header",
    "web",
    "easy",
    "A developer left debugging switched on in the status endpoint. The page body looks harmless.\n\nMake a signed-in request to /v1/lab/c/status and look closely at the response.",
    H(
      "The body isn't the only part of an HTTP response. Open your browser's dev tools, Network tab.",
      "Reload the request to /v1/lab/c/status and read the response headers, not the body.",
      "There's a header named x-debug-token. Its value is your flag.",
    ),
  ),
  c(
    "login-bypass",
    "Front Door",
    "web",
    "easy",
    "The old admin login at /v1/lab/sql/login is a museum piece: it drops whatever you type straight into a SQL query. Log in as admin without the password and it hands you the admin's note (your flag).\n\nTry /v1/lab/sql/login?username=admin&password=x first to see the query it builds.",
    H(
      "The server builds: SELECT username, note FROM users WHERE username = '<you>' AND password = '<you>'. Your input closes the quote.",
      "This is classic SQL injection. Make the WHERE always true, or comment out the password check. Everything after two dashes is a comment in SQL.",
      "Set username to  admin'--  (URL-encoded: admin%27--) and any password. Or password to  ' OR '1'='1 . The response's note field is your flag.",
    ),
  ),
  c(
    "morse-signal",
    "Signal in the Noise",
    "misc",
    "easy",
    "A dealer tapped this out on the felt. Dots and dashes, letters separated by spaces.",
    H(
      "Dots and dashes is Morse code.",
      "Paste it into any online Morse decoder (morsecode.world/international/decoder) or CyberChef's \"From Morse Code\".",
      "Decode it, then lowercase it and wrap it as snk{...} — the braces and underscores are encoded too (-.--. is '{', ..--.- is '_').",
    ),
    [{ name: "signal.txt", content: "{{FLAG_MORSE}}\n" }],
  ),
  c(
    "hidden-history",
    "Hidden History",
    "forensics",
    "easy",
    "A careless developer committed a secret, then \"removed\" it in a later commit. But git never really forgets.",
    H(
      "Read the whole log, not just the latest commit. There are two commits shown with `git show`.",
      "The commit that \"removes\" the token replaces it with a decoy. The real one is in the commit that ADDED it.",
      "The flag is the VAULT_TOKEN value added in the \"feat: add vault client\" commit, not the decoy in the removal commit.",
    ),
    [{ name: "history.txt", content: "{{GIT_LOG}}\n" }],
  ),

  // ---------------------------------------------------------------- medium
  c(
    "binary-bits",
    "Bits and Pieces",
    "crypto",
    "medium",
    "Just ones and zeros, grouped in eights. Each group is one byte of ASCII.",
    H(
      "Eight bits per group means each group is one character's byte value.",
      "Use CyberChef's \"From Binary\" (delimiter: Space), or convert each 8-bit group to a number and then to ASCII.",
      "01110011 = 0x73 = 's'. Decode every group and you have the flag.",
    ),
    [{ name: "bits.txt", content: "{{FLAG_BINARY}}\n" }],
  ),
  c(
    "single-xor",
    "One Byte Away",
    "crypto",
    "medium",
    "The flag was XORed with a single secret byte, then written as hex. Only 256 keys exist — and you already know how the plaintext starts.",
    H(
      "XOR is reversible: plaintext ^ key = cipher, so cipher ^ key = plaintext. You just need the one key byte.",
      "You know the first plaintext byte is 's' (0x73). XOR it with the first ciphertext byte to recover the key.",
      "CyberChef: \"From Hex\" then \"XOR Brute Force\" (key length 1) and look for the result containing snk{. Or XOR the whole thing with the key you found.",
    ),
    [{ name: "cipher.hex", content: "{{FLAG_XOR}}\n" }],
  ),
  c(
    "atbash-mirror",
    "Through the Mirror",
    "crypto",
    "medium",
    "An old substitution cipher where the alphabet is reversed: A becomes Z, B becomes Y, and so on. Non-letters are untouched.",
    H(
      "Each letter maps to its mirror position in the alphabet. This particular cipher is its own inverse.",
      "It's the Atbash cipher. dcode.fr has an \"Atbash\" auto-decoder, or CyberChef has an \"Atbash Cipher\" operation.",
      "Apply Atbash again to reverse it — 'h' -> 's', 'm' -> 'n', 'p' -> 'k' — and the flag falls out.",
    ),
    [{ name: "mirror.txt", content: "{{FLAG_ATBASH}}\n" }],
  ),
  c(
    "night-shift",
    "Night Shift",
    "forensics",
    "medium",
    "Something odd happened on the web server overnight. Someone probed for secrets, then smuggled data out a few characters at a time. Rebuild what they took.",
    H(
      "One IP address behaves differently from the rest — it requests things that don't exist, then hits the same tiny image over and over.",
      "Filter to that attacker's IP. The exfiltration is in requests to /static/px.gif?id=N&d=XX — id is the order, d is the data (hex).",
      "Sort those requests by id, concatenate the d= values in order, and decode the hex string (CyberChef \"From Hex\").",
    ),
    [{ name: "access.log", content: "{{ACCESS_LOG}}\n" }],
  ),
  c(
    "union-heist",
    "Union Heist",
    "web",
    "medium",
    "The shop search at /v1/lab/sql/search?q= runs your input inside a LIKE query that returns three columns (id, name, price). The vault flag sits in a different table called secrets. Pull it out.\n\nStart with /v1/lab/sql/search?q=Snake to see normal results.",
    H(
      "The query is: SELECT id, name, price FROM products WHERE name LIKE '%<q>%'. You can close the string and add your own clause.",
      "Use a UNION SELECT to append rows from another table. It must select the same number of columns (three).",
      "q =  ' UNION SELECT id, value, 0 FROM secrets--  (URL-encode it). The flag comes back in the name column of the extra row.",
    ),
  ),
  c(
    "url-smuggle",
    "Percent Signs",
    "misc",
    "medium",
    "A value pulled from a URL query string. It's been percent-encoded so it survives the trip.",
    H(
      "Those %XX sequences are URL/percent encoding. %7B is one byte, and so on.",
      "Decode it with CyberChef's \"URL Decode\", dcode.fr's URL decoder, or JavaScript's decodeURIComponent().",
      "%7B is '{', %7D is '}', %5F is '_'. Decode the whole string to get the flag.",
    ),
    [{ name: "param.txt", content: "{{FLAG_URLENC}}\n" }],
  ),

  // ---------------------------------------------------------------- hard
  c(
    "vigenere-vault",
    "Vigenère Vault",
    "crypto",
    "hard",
    "A polyalphabetic cipher: each letter is shifted by a different amount, cycling through a secret keyword. Only the letters are enciphered.",
    H(
      "Unlike Caesar, the shift changes letter to letter and repeats with the length of a secret keyword.",
      "This is the Vigenère cipher. dcode.fr's \"Vigenere Cipher\" has an automatic solver that recovers the key from the ciphertext alone.",
      "Let dcode auto-solve it (the crib snk{ helps confirm the key), or find the short keyword and decrypt. The key is a random lowercase word.",
    ),
    [{ name: "vault.txt", content: "{{FLAG_VIGENERE}}\n" }],
  ),
  c(
    "repeat-offender",
    "Repeat Offender",
    "crypto",
    "hard",
    "The flag was XORed with a short repeating key and written as hex. No brute force needed — you know how every flag begins.",
    H(
      "A repeating-key XOR reuses the same few key bytes over and over. Known plaintext breaks it instantly.",
      "You know the flag starts with \"snk{\". XOR those four known bytes with the first four ciphertext bytes to recover the start of the key.",
      "The key is only a few characters. Recover it from the snk{ crib (the key repeats, so the pattern shows), then XOR the whole ciphertext. CyberChef's \"XOR\" with \"Crib\" or a short script both work.",
    ),
    [{ name: "repeat.hex", content: "{{REPEAT_XOR}}\n" }],
  ),
  c(
    "weak-dealer",
    "Weak Dealer",
    "casino",
    "hard",
    "A rival casino shuffles with a linear congruential generator and keeps the multiplier and increment secret. You've watched six consecutive outputs. Predict the rest and the flag falls out.",
    H(
      "An LCG is x' = (a·x + c) mod m, with m = 2147483647 given. With three consecutive outputs you can solve for a and c.",
      "a = (x3 − x2) · (x2 − x1)^-1 mod m (modular inverse). Then c = (x2 − a·x1) mod m.",
      "Recover a and c, keep generating past the six shown outputs, and XOR each new output's low byte with the ciphertext bytes to get the flag.",
    ),
    [{ name: "shuffler.txt", content: "{{LCG}}\n" }],
  ),
  c(
    "admin-lounge",
    "Admin Lounge",
    "web",
    "hard",
    "The lounge at /v1/lab/c/lounge checks a JWT you're given (it's in the response the first time you visit). Members get in; you're issued a \"guest\" token. Become an admin.\n\nSend the token back in an Authorization: Bearer <token> header.",
    H(
      "Decode the token on jwt.io. It's a JWT with a role claim. Change it to admin — but it's signed (HS256), so you need the signing key.",
      "The server signed it with a weak secret: a single common password (think rockyou top 20). Crack the HS256 signature against a wordlist.",
      "Use an online JWT cracker or `hashcat -m 16500`, or just try the obvious ones. Once you have the secret, forge {\"role\":\"admin\"} on jwt.io and send it as the Bearer token.",
    ),
  ),
  c(
    "onion",
    "Onion",
    "crypto",
    "hard",
    "Layers on layers. Someone wrapped the flag three times over. Peel them in the right order.",
    H(
      "The outer layer looks like Base64. But decoding once doesn't give readable text — there's more underneath.",
      "Three layers, from the outside in: Base64, then a ROT (letter rotation), then the text is reversed.",
      "CyberChef's \"Magic\" operation (with \"Intensive mode\") often peels all three automatically. Or: From Base64 -> ROT13 -> Reverse.",
    ),
    [{ name: "onion.txt", content: "{{ONION}}\n" }],
  ),

  // ---------------------------------------------------------------- insane
  c(
    "sealed-vault",
    "Sealed Vault",
    "casino",
    "insane",
    "The vault's key stream came from a seeded PRNG, and the seed was the Unix time (in seconds) when the flag was sealed. You know the hour it happened in. That's only 3,600 seconds to try.",
    H(
      "The seed space is tiny — one of 3,600 consecutive integers. This is a brute-force over seeds.",
      "For each candidate second, seed the given mulberry32, generate the keystream, XOR it against the ciphertext, and check whether the result starts with snk{.",
      "Loop seed from the start of the stated hour to +3600, run the provided mulberry32(seed), and keep the one whose decryption begins with snk{.",
    ),
    [{ name: "vault.js", content: "{{TIMESEED}}\n" }],
  ),
  c(
    "rsa-careless",
    "Careless Keys",
    "crypto",
    "insane",
    "Textbook RSA, but whoever generated the key picked two primes that sit almost next to each other. That's fatal.",
    H(
      "When p and q are close, n is barely larger than their average squared — Fermat's factorisation finds them in a handful of steps.",
      "Factor n with Fermat's method. Alpertron's Integer Factorisation Calculator (alpertron.com.ar/ECM.HTM) or factordb.com will split n almost instantly.",
      "With p and q: phi = (p-1)(q-1), d = e^-1 mod phi, m = c^d mod n. Convert m to bytes for the flag. CyberChef's \"RSA Decrypt\" or a few lines of Python work.",
    ),
    [{ name: "key.txt", content: "{{RSA}}\n" }],
  ),
  c(
    "ecb-oracle",
    "Glass Box",
    "crypto",
    "insane",
    "The oracle at /v1/lab/sql/ecb?data=<hex> encrypts your input with your secret flag appended, using AES-128-ECB, and returns the ciphertext as hex. ECB encrypts identical blocks identically. That leaks everything.\n\nExample: /v1/lab/sql/ecb?data=00 returns the encryption of (your bytes + flag).",
    H(
      "ECB splits the input into 16-byte blocks and encrypts each independently and deterministically. Same block in, same block out.",
      "Byte-at-a-time attack: send 15 known bytes so exactly one unknown flag byte falls at the end of a block, then brute that one byte by trying all 256 values with a full known prefix.",
      "Feed lengths from 15 down to 0 to line each flag byte up as the last byte of a block, comparing the target block to your 256 guesses. Recover the flag one byte at a time. This one needs a short script.",
    ),
  ),
];
