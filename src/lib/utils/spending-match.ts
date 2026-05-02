// Normalization rules for matching transactions across rows that share a
// merchant or a stable name pattern. Rules:
//   - Lowercase, trim, collapse whitespace.
//   - Strip punctuation except internal "&".
//   - Drop tokens that are pure digits, look like store/order numbers
//     (contain digits), trailing 2-letter US state codes, or known noise
//     ("pos", "purchase", "debit", "pending", "xxxx", "trip", "help",
//     two-letter state at the tail). The noise list is conservative.
//   - Signature keeps the first 3 surviving tokens joined with single spaces.
//   - Merchant normalization is the same minus the 3-token cap, but additionally
//     strips trailing city/state-looking tokens.

const NOISE_TOKENS = new Set([
  "pos",
  "purchase",
  "debit",
  "credit",
  "pending",
  "xxxx",
  "the",
  "inc",
  "llc",
  "co",
  "com",
]);

const US_STATES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in",
  "ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv",
  "nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn",
  "tx","ut","vt","va","wa","wv","wi","wy","dc",
]);

function basicTokens(input: string): string[] {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9&\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(" ");
}

function isStoreOrIdToken(tok: string): boolean {
  if (/^\d+$/.test(tok)) return true;
  // contains a digit somewhere — treat as a store/order/transaction id fragment
  if (/\d/.test(tok)) return true;
  return false;
}

function dropMeaninglessTokens(tokens: string[]): string[] {
  return tokens.filter((t) => {
    if (!t) return false;
    if (t.length === 1 && t !== "&") return false;
    if (NOISE_TOKENS.has(t)) return false;
    if (isStoreOrIdToken(t)) return false;
    return true;
  });
}

function stripTrailingStates(tokens: string[]): string[] {
  const out = [...tokens];
  while (out.length > 0 && US_STATES.has(out[out.length - 1])) out.pop();
  return out;
}

export function normalizeMerchant(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const tokens = stripTrailingStates(dropMeaninglessTokens(basicTokens(input)));
  if (tokens.length === 0) return null;
  return tokens.join(" ");
}

export function computeNameSignature(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const tokens = dropMeaninglessTokens(basicTokens(input));
  if (tokens.length === 0) return null;
  return tokens.slice(0, 3).join(" ");
}
