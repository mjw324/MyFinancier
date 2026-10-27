/**
 * Cleaning for transaction text that reaches the model. Merchant names and
 * memos are attacker-controlled (anyone can send a one-cent Zelle with an
 * instruction in the memo), so before a label leaves the app it is:
 *   - NFKC-normalised, with control and invisible (format) characters removed
 *   - stripped of URLs, markup and placeholder braces
 *   - collapsed and truncated
 * and a person-to-person counterparty is replaced with a stable token, so the
 * model never sees a private individual's name.
 */

import { createHash } from "node:crypto";

export const MAX_LABEL_CHARS = 48;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const CONTROL_RE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;
const MARKUP_RE = /[<>{}[\]`\\|*_#]/g;

export function cleanLabel(raw: string | null | undefined, max = MAX_LABEL_CHARS): string {
  if (!raw) return "";
  const s = raw
    .normalize("NFKC")
    .replace(CONTROL_RE, " ")
    .replace(URL_RE, " ")
    .replace(MARKUP_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Payment apps whose descriptions name a person rather than a business. */
const P2P_RE = /\b(?:zelle|venmo|cash\s?app|square\s?cash|paypal|apple\s?cash)\b/i;

export function isPersonToPerson(text: {
  description?: string | null;
  merchantName?: string | null;
  pfcPrimary?: string | null;
}): boolean {
  if (text.pfcPrimary === "TRANSFER_IN" || text.pfcPrimary === "TRANSFER_OUT") return true;
  return P2P_RE.test(text.description ?? "") || P2P_RE.test(text.merchantName ?? "");
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * "Contact KX": the same person always maps to the same token for one user,
 * and tokens carry no digits (so they can't be mistaken for figures).
 */
export function counterpartyToken(userId: string, name: string): string {
  const key = name.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  const hash = createHash("sha256").update(`${userId}\u0000${key}`).digest();
  return `Contact ${LETTERS[hash[0] % LETTERS.length]}${LETTERS[hash[1] % LETTERS.length]}`;
}
