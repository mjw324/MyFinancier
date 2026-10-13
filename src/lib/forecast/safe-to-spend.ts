/**
 * Safe to spend — pure computation.
 *
 * Definition (one semantic, shown to the user as such):
 *
 *   "What you can spend before your next paycheck lands."
 *
 *   spendable cash in open checking/savings accounts
 *   − bills expected from today through the day BEFORE the next paycheck
 *   − card payments due in that window (detected card-payment schedule), or,
 *     when no card-payment schedule is detected, the full card balances.
 *     Never both: the payment stream already pays those balances.
 *
 * - The paycheck must be an INCOME stream; any other inflow (a Venmo receipt,
 *   a transfer from savings) is never a paycheck. Predicted inflows are not
 *   added: the horizon ends before the paycheck by construction.
 * - Transfers, savings moves and card payments are not "bills".
 * - Streams with no activity for more than a cycle are "possibly ended" and not
 *   counted; tentative (EARLY_DETECTION) streams are listed, not summed.
 * - A bill that already posted (or is pending) within ±3 days of its expected
 *   date is not counted again — pending activity is already in the balance.
 * - Loans and investments never enter the number; closed and non-USD accounts
 *   are excluded.
 * - Without a paycheck, the horizon is the next 30 days.
 */

import {
  addUtcDays,
  assessStream,
  isBillStream,
  isCardPaymentStream,
  isIncomeStream,
  isTransferStream,
  projectStreamEvents,
  utcDay,
  type Frequency,
  type ProjectionInputStream,
} from "@/lib/plaid/projection";
import { toCents, type AccountBalanceView } from "@/lib/utils/balances";
import { displayName } from "@/lib/utils/format";

export const DEFAULT_HORIZON_DAYS = 30;
export const PAYCHECK_SEARCH_DAYS = 35;

export interface ForecastStream extends ProjectionInputStream {
  accountId: string;
}

/** A recent transaction (posted or pending) used to recognise paid occurrences. */
export interface ForecastTxn {
  id: string;
  accountId: string;
  recurringStreamId: string | null;
  amount: string;
  date: Date;
  pending: boolean | null;
  name: string;
  merchantName: string | null;
}

export type ForecastKind = "bill" | "card_payment" | "income" | "transfer" | "other_inflow";

export interface ForecastItem {
  streamId: string;
  label: string;
  date: Date;
  dueDate: Date;
  /** Always positive. */
  amountCents: number;
  flowType: "inflow" | "outflow";
  frequency: Frequency;
  kind: ForecastKind;
  late: boolean;
  tentative: boolean;
  hasPriceChange: boolean;
}

export interface EndedStream {
  streamId: string;
  label: string;
  kind: ForecastKind;
  lastSeen: Date | null;
  expected: Date | null;
  amountCents: number;
}

export interface SafeToSpendResult {
  today: Date;
  /** Inclusive last day of the horizon. */
  through: Date;
  horizonSource: "next_paycheck" | "default_30d";
  paycheck: ForecastItem | null;
  cashCents: number;
  cashAccounts: Array<{ id: string; name: string; cents: number; isStale: boolean; asOf: Date | null }>;
  cardMode: "payment_stream" | "card_balance";
  cardObligationsCents: number;
  /** Σ owed on open cards (information; subtracted only in card_balance mode). */
  cardBalancesCents: number;
  billsCents: number;
  safeToSpendCents: number;
  /** Counted: bills and (payment_stream mode) card payments, by date. */
  upcoming: ForecastItem[];
  /** Listed, not counted. */
  tentative: ForecastItem[];
  possiblyEnded: EndedStream[];
  excludedAccounts: Array<{ id: string; name: string; reason: "unavailable" | "foreign_currency" }>;
  staleAccounts: Array<{ id: string; name: string; asOf: Date | null }>;
}

// ---------------------------------------------------------------------------
// Matching transactions to streams (7.6)
// ---------------------------------------------------------------------------

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function namesMatch(stream: ForecastStream, t: ForecastTxn): boolean {
  const a = [stream.merchantName, stream.description, stream.customName].map(norm).filter((x) => x.length >= 4);
  const b = [t.merchantName, t.name].map(norm).filter((x) => x.length >= 4);
  return a.some((x) => b.some((y) => x === y || x.includes(y) || y.includes(x)));
}

/**
 * Dates of recent transactions that belong to the stream: linked by Plaid, or
 * (for pending rows Plaid has not linked yet) same account, same direction,
 * similar amount and matching name.
 */
export function settledDatesForStream(stream: ForecastStream, txns: ForecastTxn[]): Date[] {
  const expected = Math.abs(toCents(String(stream.lastAmount)) ?? 0);
  const tolerance = Math.max(100, Math.round(expected * 0.1));
  const out: Date[] = [];
  for (const t of txns) {
    if (t.recurringStreamId === stream.streamId) {
      out.push(utcDay(t.date));
      continue;
    }
    if (t.recurringStreamId !== null || t.accountId !== stream.accountId) continue;
    const cents = toCents(t.amount) ?? 0;
    const sameDirection = stream.flowType === "outflow" ? cents > 0 : cents < 0;
    if (!sameDirection) continue;
    if (Math.abs(Math.abs(cents) - expected) > tolerance) continue;
    if (!namesMatch(stream, t)) continue;
    out.push(utcDay(t.date));
  }
  return out;
}

// ---------------------------------------------------------------------------

function kindOf(s: ForecastStream): ForecastKind {
  if (isIncomeStream(s)) return "income";
  if (s.flowType === "inflow") return "other_inflow";
  if (isCardPaymentStream(s)) return "card_payment";
  if (isTransferStream(s)) return "transfer";
  return "bill";
}

function labelOf(s: ForecastStream): string {
  return displayName({
    customName: s.customName,
    merchantName: s.merchantName,
    fallback: s.description,
  });
}

function amountCentsOf(s: ForecastStream): number {
  return Math.abs(toCents(String(s.lastAmount)) ?? 0);
}

/** Streams whose account can carry a forecast (open, USD). */
function eligibleStreams(streams: ForecastStream[], accounts: AccountBalanceView[]) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return streams.filter((s) => {
    if (!s.isActive || s.status === "TOMBSTONED") return false;
    const acct = byId.get(s.accountId);
    return !!acct && acct.state !== "closed" && acct.state !== "foreign_currency";
  });
}

export interface ForecastWindowInput {
  today: Date;
  streams: ForecastStream[];
  txns: ForecastTxn[];
  accounts: AccountBalanceView[];
}

/**
 * Every expected stream event in [from, to] (inclusive) plus the streams that
 * look ended. Used by the bill calendar and by safe-to-spend.
 */
export function forecastWindow(
  input: ForecastWindowInput,
  from: Date,
  to: Date,
): { events: ForecastItem[]; possiblyEnded: EndedStream[] } {
  const today = utcDay(input.today);
  const events: ForecastItem[] = [];
  const possiblyEnded: EndedStream[] = [];

  for (const s of eligibleStreams(input.streams, input.accounts)) {
    const settled = settledDatesForStream(s, input.txns);
    const kind = kindOf(s);
    const assessment = assessStream(s, today, settled);
    if (assessment.health === "stale") {
      possiblyEnded.push({
        streamId: s.streamId,
        label: labelOf(s),
        kind,
        lastSeen: assessment.lastSeen,
        expected: assessment.nextDue,
        amountCents: amountCentsOf(s),
      });
      continue;
    }
    if (to < from) continue;
    for (const e of projectStreamEvents(s, from, to, { today, settledDates: settled })) {
      events.push({
        streamId: s.streamId,
        label: labelOf(s),
        date: e.date,
        dueDate: e.dueDate,
        amountCents: amountCentsOf(s),
        flowType: s.flowType,
        frequency: s.frequency,
        kind,
        late: e.late,
        tentative: s.status !== "MATURE",
        hasPriceChange: e.hasPriceChange,
      });
    }
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.label.localeCompare(b.label));
  return { events, possiblyEnded };
}

export interface SafeToSpendInput extends ForecastWindowInput {
  defaultHorizonDays?: number;
  paycheckSearchDays?: number;
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const today = utcDay(input.today);
  const defaultDays = input.defaultHorizonDays ?? DEFAULT_HORIZON_DAYS;
  const searchDays = input.paycheckSearchDays ?? PAYCHECK_SEARCH_DAYS;

  // 1. Next paycheck: the earliest expected event of a mature INCOME stream.
  const search = forecastWindow(input, today, addUtcDays(today, searchDays));
  const paycheck =
    search.events.find((e) => e.kind === "income" && !e.tentative) ?? null;

  // 2. Horizon ends the day before the paycheck lands (never before today).
  let through: Date;
  if (paycheck) {
    const dayBefore = addUtcDays(paycheck.date, -1);
    through = dayBefore < today ? today : dayBefore;
  } else {
    through = addUtcDays(today, defaultDays - 1);
  }

  const window = forecastWindow(input, today, through);
  const outflows = window.events.filter((e) => e.kind === "bill" || e.kind === "card_payment");
  const upcoming = outflows.filter((e) => !e.tentative);
  const tentative = outflows.filter((e) => e.tentative);

  // 3. Card payments: the detected schedule, or the balances — never both.
  const hasCardSchedule = eligibleStreams(input.streams, input.accounts).some(
    (s) =>
      isCardPaymentStream(s) &&
      s.status === "MATURE" &&
      !window.possiblyEnded.some((p) => p.streamId === s.streamId),
  );
  const cards = input.accounts.filter((a) => a.kind === "credit" && a.state === "ok");
  const cardBalancesCents = cards.reduce((sum, a) => sum + Math.max(0, a.projectedCents ?? 0), 0);

  let billsCents = 0;
  let cardObligationsCents = 0;
  const counted: ForecastItem[] = [];
  for (const e of upcoming) {
    if (e.kind === "card_payment") {
      if (!hasCardSchedule) continue;
      cardObligationsCents += e.amountCents;
    } else {
      billsCents += e.amountCents;
    }
    counted.push(e);
  }
  if (!hasCardSchedule) cardObligationsCents = cardBalancesCents;

  // 4. Spendable cash: open USD depository accounts only.
  const cash = input.accounts.filter((a) => a.kind === "cash" && a.state === "ok");
  const cashCents = cash.reduce((sum, a) => sum + (a.projectedCents ?? 0), 0);

  const relevant = input.accounts.filter((a) => a.kind === "cash" || a.kind === "credit");

  return {
    today,
    through,
    horizonSource: paycheck ? "next_paycheck" : "default_30d",
    paycheck,
    cashCents,
    cashAccounts: cash.map((a) => ({
      id: a.id,
      name: a.name,
      cents: a.projectedCents ?? 0,
      isStale: a.isStale,
      asOf: a.balanceAsOf,
    })),
    cardMode: hasCardSchedule ? "payment_stream" : "card_balance",
    cardObligationsCents,
    cardBalancesCents,
    billsCents,
    safeToSpendCents: cashCents - billsCents - cardObligationsCents,
    upcoming: counted,
    tentative,
    possiblyEnded: window.possiblyEnded.filter(
      (p) => p.kind === "bill" || p.kind === "card_payment",
    ),
    excludedAccounts: relevant
      .filter((a) => a.state === "unavailable" || a.state === "foreign_currency")
      .map((a) => ({
        id: a.id,
        name: a.name,
        reason: a.state as "unavailable" | "foreign_currency",
      })),
    staleAccounts: relevant
      .filter((a) => a.state === "ok" && a.isStale)
      .map((a) => ({ id: a.id, name: a.name, asOf: a.balanceAsOf })),
  };
}
