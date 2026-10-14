/**
 * Account balance math (pure).
 *
 * Money is handled as integer cents so sums are exact: Postgres `numeric`
 * arrives as a string, and summing parsed floats gives 0.30000000000000004.
 *
 * Plaid conventions:
 * - Transaction amounts: > 0 money out, < 0 money in.
 * - Depository `current` excludes pending activity at most institutions;
 *   `available` usually reflects holds but can also include an overdraft line.
 * - Credit/loan `current` is the amount owed. On a card, `available` is the
 *   remaining credit line — never a balance.
 * - Investment balances are null unless the Investments product is enabled.
 */

import { isLiabilityType } from "./account-type";

export type AccountKind = "cash" | "credit" | "loan" | "investment" | "other";

export type BalanceState =
  /** Balance known and counted in totals. */
  | "ok"
  /** No balance from the bank (e.g. investments without the product). */
  | "unavailable"
  /** Closed or no longer returned by the bank. */
  | "closed"
  /** Not in USD; excluded from totals rather than silently added. */
  | "foreign_currency";

export const BASE_CURRENCY = "USD";
export const DEFAULT_STALE_AFTER_DAYS = 3;

export interface AccountBalanceInput {
  id: string;
  name: string;
  type: string;
  currentBalance: string | null;
  availableBalance: string | null;
  creditLimit?: string | null;
  isoCurrencyCode: string | null;
  lastSyncedAt: Date | null;
  closedAt?: Date | null;
  /** Σ amounts of this account's recent pending transactions, in cents (Plaid sign). */
  pendingCents: number;
}

export interface AccountBalanceView {
  id: string;
  name: string;
  type: string;
  kind: AccountKind;
  state: BalanceState;
  currency: string;
  includedInTotals: boolean;
  /** Current balance (amount owed for liabilities). Null when unavailable. */
  settledCents: number | null;
  /**
   * Balance after pending activity. Depository: the lower of `available` and
   * current − pending (an overdraft line can inflate `available`). Credit:
   * owed + pending charges. Others: current.
   */
  projectedCents: number | null;
  /** Signed contribution to net worth (liabilities negative); 0 when excluded. */
  netWorthSettledCents: number;
  netWorthProjectedCents: number;
  availableCents: number | null;
  creditLimitCents: number | null;
  /** True when the limit was derived as owed + available (no limit from the bank). */
  creditLimitEstimated: boolean;
  /** Owed / limit (cards only). */
  utilization: number | null;
  balanceAsOf: Date | null;
  isStale: boolean;
}

/** Exact decimal-string → integer cents (rounds half away from zero). */
export function toCents(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    return Number.isFinite(v) ? Math.round(v * 100) : null;
  }
  const s = v.trim();
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    const n = Number(s); // exponent forms like "1e3"
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  const sign = m[1] === "-" ? -1 : 1;
  const whole = m[2] === "" ? 0 : Number(m[2]);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = whole * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  return sign * cents;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function accountKind(type: string): AccountKind {
  switch (type) {
    case "depository":
      return "cash";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
      return "investment";
    default:
      return "other";
  }
}

export function computeAccountBalance(
  a: AccountBalanceInput,
  {
    now = new Date(),
    staleAfterDays = DEFAULT_STALE_AFTER_DAYS,
  }: { now?: Date; staleAfterDays?: number } = {},
): AccountBalanceView {
  const kind = accountKind(a.type);
  const currency = (a.isoCurrencyCode ?? BASE_CURRENCY).toUpperCase();
  const current = toCents(a.currentBalance);
  const available = toCents(a.availableBalance);
  const pending = Number.isFinite(a.pendingCents) ? a.pendingCents : 0;

  let state: BalanceState = "ok";
  if (a.closedAt) state = "closed";
  else if (current === null) state = "unavailable";
  else if (currency !== BASE_CURRENCY) state = "foreign_currency";

  let projected: number | null = null;
  if (current !== null) {
    if (kind === "cash") {
      const afterPending = current - pending;
      projected = available !== null ? Math.min(available, afterPending) : afterPending;
    } else if (kind === "credit") {
      projected = current + pending;
    } else {
      projected = current;
    }
  }

  let creditLimit: number | null = null;
  let estimated = false;
  if (kind === "credit") {
    creditLimit = toCents(a.creditLimit ?? null);
    if (creditLimit === null && available !== null && current !== null) {
      creditLimit = current + available;
      estimated = true;
    }
    if (creditLimit !== null && creditLimit <= 0) creditLimit = null;
  }
  const utilization =
    kind === "credit" && creditLimit !== null && current !== null
      ? Math.max(0, current) / creditLimit
      : null;

  const included = state === "ok";
  const sign = isLiabilityType(a.type) ? -1 : 1;
  const isStale =
    a.lastSyncedAt === null ||
    now.getTime() - a.lastSyncedAt.getTime() > staleAfterDays * 86_400_000;

  return {
    id: a.id,
    name: a.name,
    type: a.type,
    kind,
    state,
    currency,
    includedInTotals: included,
    settledCents: current,
    projectedCents: projected,
    netWorthSettledCents: included && current !== null ? sign * current : 0,
    netWorthProjectedCents: included && projected !== null ? sign * projected : 0,
    availableCents: available,
    creditLimitCents: creditLimit,
    creditLimitEstimated: estimated,
    utilization,
    balanceAsOf: a.lastSyncedAt,
    isStale: state === "closed" ? false : isStale,
  };
}
