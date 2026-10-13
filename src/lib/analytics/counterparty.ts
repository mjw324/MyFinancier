/**
 * Counterparty identity — "who was on the other side of this transaction".
 *
 * Grouping money by merchant or payer only works when the same counterparty
 * collapses to one key across statements. Plaid's merchant_name covers most
 * card purchases but is usually empty for person-to-person payments, whose
 * descriptions embed the name in the payment app's own format:
 *
 *   Payment-app note format:   Jane Example "dinner"
 *   Zelle format:              Zelle payment from JANE EXAMPLE ABC123XYZ9
 *
 * The note and the reference are per-payment and must not become part of the
 * key, or every payment from the same person lands in its own bucket.
 *
 * Pure: no I/O.
 */

import { normalizeMerchant } from "@/lib/utils/spending-match";

const QUOTED_NOTE = /^([^"“”]+)["“]/;

/** Zelle: name between a fixed prefix and an optional opaque reference. */
const ZELLE =
  /zelle\s+(?:payment|transfer)?\s*(?:from|to)\s+(.+?)(?:\s+(?:[A-Za-z]{2,4}[0-9][0-9A-Za-z]{4,}|[0-9]{5,}|on\s+\d.*))?\s*$/i;

/** Descriptions that identify a mechanism rather than a counterparty. */
const MECHANISMS: Array<{ test: RegExp; key: string }> = [
  { test: /\batm\b.*\b(?:cash|check)\s+deposit/i, key: "atm deposit" },
  { test: /\b(?:atm|withdraw(?:al)?)\b.*\bfee\b/i, key: "atm fee" },
  { test: /\batm\b.*\bwithdraw/i, key: "atm withdrawal" },
  { test: /^(?:non-\w+\s+)?atm\b/i, key: "atm withdrawal" },
  { test: /^\s*withdrawal\b/i, key: "withdrawal" },
  { test: /^\s*(?:teller\s+)?check\b(?:\s*#?\s*\d+)?\s*$/i, key: "check" },
  { test: /\b(?:remote|mobile)?\s*(?:online\s+)?deposit\b/i, key: "deposit" },
  { test: /\b(?:standard|instant)\s+transfer\b/i, key: "account transfer" },
  { test: /\bpayment\b.*\bthank\s?you\b|\bthank\s?you\b.*\bpayment\b/i, key: "card payment" },
  { test: /\b(?:autopay|auto-pmt|directpay)\b/i, key: "card payment" },
];

export interface CounterpartyInput {
  name: string | null;
  merchantName?: string | null;
  /** A user-supplied alias wins over anything derived. */
  customName?: string | null;
}

/**
 * Pulls a person's name out of a payment-app or Zelle description. Returns
 * null when the description is not in a recognised person-to-person format.
 */
export function extractPersonName(description: string | null | undefined): string | null {
  if (!description) return null;
  const zelle = description.match(ZELLE);
  if (zelle?.[1]) {
    const name = zelle[1].trim();
    if (name) return name;
  }
  // Only a quoted note marks a person: a bare merchant name has no quotes.
  if (/["“”]/.test(description)) {
    const quoted = description.match(QUOTED_NOTE);
    const name = quoted?.[1]?.trim();
    if (name && name.length >= 2) return name;
  }
  return null;
}

/**
 * Stable grouping key for "who". Lowercased and stripped of store numbers,
 * locations and payment noise, so "COFFEE SHOP #123" and "Coffee Shop 456"
 * share a key. Returns null when nothing meaningful survives.
 */
export function counterpartyKey(txn: CounterpartyInput): string | null {
  const custom = txn.customName?.trim();
  if (custom) return normalizeMerchant(custom);

  const merchant = txn.merchantName?.trim();
  if (merchant) return normalizeMerchant(merchant);

  const raw = txn.name?.trim() ?? "";
  if (!raw) return null;

  const person = extractPersonName(raw);
  if (person) return normalizeMerchant(person);

  for (const { test, key } of MECHANISMS) {
    if (test.test(raw)) return key;
  }

  return normalizeMerchant(raw);
}
