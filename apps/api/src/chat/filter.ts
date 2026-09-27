import { CHAT_MAX_LENGTH } from "@snakeland/shared";

/**
 * Keeps chat readable and safe: no control characters, no links (the classic
 * phishing vector in casino chats), and common abuse masked out.
 */
const BLOCKED = [
  "fuck",
  "fucking",
  "shit",
  "cunt",
  "bitch",
  "bastard",
  "dick",
  "pussy",
  "asshole",
  "slut",
  "whore",
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
  "kys",
  "rape",
  "rapist",
  "nazi",
];
const WORD_RE = new RegExp(`\\b(${BLOCKED.join("|")})\\w*`, "gi");
const LINK_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|io|gg|xyz|app|ru|cn|co|me|link|site|ly)\b\S*/gi;
// Controls, zero-width and bidi-override characters.
// eslint-disable-next-line no-control-regex
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

export function cleanChat(input: string): string {
  return input
    .normalize("NFKC")
    .replace(INVISIBLE_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX_LENGTH)
    .replace(LINK_RE, "[link removed]")
    .replace(WORD_RE, (w) => w[0] + "*".repeat(Math.max(2, w.length - 1)));
}
