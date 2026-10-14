/**
 * Recurring-stream projection (pure, no I/O).
 *
 * Stream and transaction dates are calendar dates stored as UTC-midnight
 * timestamps, so every computation here uses UTC getters/constructors. Local
 * getters would move a bill to the previous day for anyone west of UTC.
 *
 * "today" is always the viewer's calendar date (see getUserToday), passed in by
 * the caller; it is never derived from the server clock here.
 */

export type Frequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";

export type StreamStatus =
  | "MATURE"
  | "EARLY_DETECTION"
  | "TOMBSTONED"
  | "UNKNOWN";

export type FlowType = "inflow" | "outflow";

export interface ProjectionInputStream {
  streamId: string;
  flowType: FlowType;
  frequency: Frequency;
  status: StreamStatus;
  isActive: boolean;
  predictedNextDate: Date | null;
  lastDate: Date | null;
  averageAmount: number;
  lastAmount: number;
  merchantName: string | null;
  description: string;
  customName: string | null;
  accountId?: string;
  pfcPrimary?: string | null;
  pfcDetailed?: string | null;
  /** Optional: posted dates of recent transactions, newest first.
   *  Used to derive the two days-of-month for SEMI_MONTHLY streams. */
  recentTransactionDates?: Date[];
}

export interface ProjectedEvent {
  streamId: string;
  /** The day the event is shown/counted on (today for a late occurrence). */
  date: Date;
  /** The day the occurrence was expected. Differs from `date` when late. */
  dueDate: Date;
  amount: number;
  flowType: FlowType;
  frequency: Frequency;
  status: StreamStatus;
  merchantName: string | null;
  description: string;
  customName: string | null;
  hasPriceChange: boolean;
  tentative: boolean;
  /** Expected before today, not seen yet, and not old enough to be stale. */
  late: boolean;
}

export interface ProjectionOptions {
  /** The viewer's calendar date (UTC midnight). Defaults to windowStart. */
  today?: Date;
  /**
   * Dates of transactions (posted or pending) that belong to this stream and
   * are recent enough to settle an occurrence. An occurrence with a settled
   * transaction within ±PAID_MATCH_WINDOW_DAYS is already paid and is not
   * projected again (a bill posted yesterday must not also count as due).
   */
  settledDates?: Date[];
}

const MS_PER_DAY = 86_400_000;
const PRICE_CHANGE_THRESHOLD = 0.05;

/** ±days within which a posted/pending transaction settles an occurrence. */
export const PAID_MATCH_WINDOW_DAYS = 3;

/** Nominal length of one cycle. */
export const PERIOD_DAYS: Record<Frequency, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  SEMI_MONTHLY: 15,
  MONTHLY: 30,
  ANNUALLY: 365,
  UNKNOWN: 30,
};

/** How late an occurrence may run before the stream is treated as ended. */
export const GRACE_DAYS: Record<Frequency, number> = {
  WEEKLY: 3,
  BIWEEKLY: 5,
  SEMI_MONTHLY: 5,
  MONTHLY: 7,
  ANNUALLY: 30,
  UNKNOWN: 7,
};

// ---------------------------------------------------------------------------
// UTC calendar helpers
// ---------------------------------------------------------------------------

export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addUtcDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / MS_PER_DAY);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addMonthsClamped(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const target = date.getUTCMonth() + months;
  const year = y + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), lastDayOfMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

// ---------------------------------------------------------------------------
// Stream classification
// ---------------------------------------------------------------------------

const CC_PAYMENT_DETAILED = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const TRANSFER_PRIMARIES = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);

type Categorised = Pick<
  ProjectionInputStream,
  "pfcPrimary" | "pfcDetailed" | "description" | "flowType"
>;

/** A payment from a linked account to a credit card. */
export function isCardPaymentStream(s: Categorised): boolean {
  if (s.pfcDetailed === CC_PAYMENT_DETAILED) return true;
  return (
    s.flowType === "outflow" &&
    s.pfcPrimary === "LOAN_PAYMENTS" &&
    /\bcard\b|credit\s*crd|crd\s*pmt/i.test(s.description)
  );
}

/** Money moving between the user's own accounts or into savings. */
export function isTransferStream(s: Categorised): boolean {
  return TRANSFER_PRIMARIES.has(s.pfcPrimary ?? "");
}

/** An outflow that should be counted as a bill (not a transfer or card payment). */
export function isBillStream(s: Categorised): boolean {
  return s.flowType === "outflow" && !isTransferStream(s) && !isCardPaymentStream(s);
}

/** Earned income: the only kind of inflow that can anchor "next paycheck". */
export function isIncomeStream(s: Categorised): boolean {
  return s.flowType === "inflow" && s.pfcPrimary === "INCOME";
}

/** Price change regardless of sign (inflow amounts are negative in Plaid's convention). */
export function hasPriceChange(averageAmount: number, lastAmount: number): boolean {
  const avg = Math.abs(averageAmount);
  const last = Math.abs(lastAmount);
  return avg > 0 && Math.abs(last - avg) / avg > PRICE_CHANGE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type StreamHealth = "ok" | "late" | "stale";

export interface StreamAssessment {
  health: StreamHealth;
  /** The first occurrence not settled by a transaction (null: none known). */
  nextDue: Date | null;
  /** Days nextDue lies before today (0 when not overdue). */
  overdueDays: number;
  /** Most recent evidence of the stream: last_date or a settled transaction. */
  lastSeen: Date | null;
  daysSinceLastSeen: number | null;
}

function isSettled(due: Date, settled: Date[]): boolean {
  return settled.some(
    (s) => Math.abs(daysBetween(s, due)) <= PAID_MATCH_WINDOW_DAYS,
  );
}

/**
 * Is the stream still alive? Plaid keeps `predicted_next_date` in the past for
 * streams that stopped (a card that was paid off, a cancelled utility), and
 * projecting from it would invent a bill every cycle.
 *
 * - stale: the next expected occurrence is more than one period + grace
 *   overdue, or nothing has posted for more than one period + grace since the
 *   stream was last seen. Stale streams are not projected ("possibly ended").
 * - late: overdue but within that tolerance; still expected, counted today.
 */
export function assessStream(
  stream: ProjectionInputStream,
  today: Date,
  settledDates: Date[] = [],
): StreamAssessment {
  const t = utcDay(today);
  const settled = settledDates.map(utcDay);
  const limit = PERIOD_DAYS[stream.frequency] + GRACE_DAYS[stream.frequency];

  const evidence = [
    ...(stream.lastDate ? [utcDay(stream.lastDate)] : []),
    ...settled.filter((d) => d <= t),
  ];
  const lastSeen = evidence.length
    ? new Date(Math.max(...evidence.map((d) => d.getTime())))
    : null;
  const daysSinceLastSeen = lastSeen ? daysBetween(lastSeen, t) : null;

  let nextDue: Date | null = null;
  if (stream.predictedNextDate) {
    // Walk forward past occurrences that a transaction already settled
    // (Plaid advances predicted_next_date only on its next refresh).
    for (const due of occurrences(stream, addUtcDays(t, PAID_MATCH_WINDOW_DAYS + 400))) {
      if (!isSettled(due, settled)) {
        nextDue = due;
        break;
      }
    }
  }
  const overdueDays = nextDue && nextDue < t ? daysBetween(nextDue, t) : 0;

  let health: StreamHealth = "ok";
  if (
    overdueDays > limit ||
    (daysSinceLastSeen !== null && daysSinceLastSeen > limit)
  ) {
    health = "stale";
  } else if (overdueDays > 0) {
    health = "late";
  }

  return { health, nextDue, overdueDays, lastSeen, daysSinceLastSeen };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** Every expected occurrence from predicted_next_date through `until` (inclusive). */
function occurrences(stream: ProjectionInputStream, until: Date): Date[] {
  if (!stream.predictedNextDate) return [];
  const anchor = utcDay(stream.predictedNextDate);
  const end = utcDay(until);
  if (stream.frequency === "UNKNOWN") return anchor <= end ? [anchor] : [];
  if (stream.frequency === "SEMI_MONTHLY") return semiMonthly(stream, anchor, end);

  const out: Date[] = [];
  for (let i = 0; i < 600; i++) {
    const d = stepFromAnchor(anchor, i, stream.frequency);
    if (d > end) break;
    out.push(d);
  }
  return out;
}

function stepFromAnchor(anchor: Date, steps: number, frequency: Frequency): Date {
  switch (frequency) {
    case "WEEKLY":
      return addUtcDays(anchor, 7 * steps);
    case "BIWEEKLY":
      return addUtcDays(anchor, 14 * steps);
    case "MONTHLY":
      return addMonthsClamped(anchor, steps);
    case "ANNUALLY":
      return addMonthsClamped(anchor, 12 * steps);
    default:
      return addUtcDays(anchor, steps);
  }
}

function semiMonthly(stream: ProjectionInputStream, anchor: Date, end: Date): Date[] {
  const days = deriveSemiMonthlyDays(stream);
  const out: Date[] = [];
  let year = anchor.getUTCFullYear();
  let month = anchor.getUTCMonth();
  for (let i = 0; i < 400; i++) {
    const first = new Date(Date.UTC(year, month, 1));
    if (first > end) break;
    const last = lastDayOfMonth(year, month);
    for (const dom of days) {
      const day = dom === -1 ? last : Math.min(dom, last);
      const candidate = new Date(Date.UTC(year, month, day));
      if (candidate < anchor || candidate > end) continue;
      out.push(candidate);
    }
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** Returns up to two days-of-month (1-31, or -1 for last-day-of-month). */
function deriveSemiMonthlyDays(stream: ProjectionInputStream): number[] {
  const recent = stream.recentTransactionDates ?? [];
  const doms = new Set<number>();
  for (const d of recent.slice(0, 4)) {
    const day = d.getUTCDate();
    const last = lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth());
    doms.add(day === last ? -1 : day);
    if (doms.size === 2) break;
  }
  if (doms.size === 2) return [...doms].sort(sortDom);
  if (doms.size === 1) {
    const only = [...doms][0];
    if (only === -1 || only > 20) return [15, -1];
    return [only, -1];
  }
  return [15, -1];
}

function sortDom(a: number, b: number): number {
  const av = a === -1 ? 32 : a;
  const bv = b === -1 ? 32 : b;
  return av - bv;
}

/**
 * Expected events of one stream inside [windowStart, windowEnd] (inclusive
 * calendar days). Stale streams produce nothing; occurrences already settled
 * by a transaction are skipped; a late occurrence is placed on `today`.
 */
export function projectStreamEvents(
  stream: ProjectionInputStream,
  windowStart: Date,
  windowEnd: Date,
  opts: ProjectionOptions = {},
): ProjectedEvent[] {
  if (!stream.isActive) return [];
  if (stream.status === "TOMBSTONED") return [];
  if (!stream.predictedNextDate) return [];

  const start = utcDay(windowStart);
  const end = utcDay(windowEnd);
  const today = utcDay(opts.today ?? windowStart);
  const settled = (opts.settledDates ?? []).map(utcDay);

  if (assessStream(stream, today, settled).health === "stale") return [];

  const tentative = stream.status === "EARLY_DETECTION";
  const priceChange = hasPriceChange(stream.averageAmount, stream.lastAmount);
  const event = (date: Date, dueDate: Date, late: boolean): ProjectedEvent => ({
    streamId: stream.streamId,
    date,
    dueDate,
    amount: stream.lastAmount,
    flowType: stream.flowType,
    frequency: stream.frequency,
    status: stream.status,
    merchantName: stream.merchantName,
    description: stream.description,
    customName: stream.customName,
    hasPriceChange: priceChange,
    tentative,
    late,
  });

  const events: ProjectedEvent[] = [];
  for (const due of occurrences(stream, end)) {
    if (isSettled(due, settled)) continue;
    if (due < today) {
      if (today >= start && today <= end) events.push(event(today, due, true));
      continue;
    }
    if (due >= start) events.push(event(due, due, false));
  }
  return events;
}
