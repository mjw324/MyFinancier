/**
 * Period resolution.
 *
 * The dashboard currently calls a rolling 30-day window "this month" while the
 * stat cards beside it use the calendar month, so two numbers on the same card
 * describe different spans. Worse, comparing a partial current month against a
 * complete prior month always shows a fall, and for someone paid biweekly the
 * three-payday months (Oct 2025, May 2026 for the reference user) read as +50%
 * income spikes that never happened.
 *
 * Every period this module returns is labelled and carries the metadata a
 * caller needs to present it honestly.
 *
 * All boundaries are computed in UTC. Calendar dates are stored as
 * UTC-midnight timestamps, and the server runs in UTC while viewers do not, so
 * local getters would shift a day.
 *
 * See docs/audits/analytics-model-spec-2026-09-02.md section 4.2.
 */

export type PeriodKind = "calendar" | "rolling" | "paycheck";

export type CalendarUnit = "month" | "quarter" | "year";

export interface Period {
  start: Date;
  /** Exclusive. Use `date >= start AND date < end` so no row is double-counted. */
  end: Date;
  kind: PeriodKind;
  /** Short human label, e.g. "August 2026", "Last 30 days". */
  label: string;
  /** True when `end` is in the future: totals are not yet comparable. */
  isPartial: boolean;
  /** Days elapsed so far. Equals `totalDays` for a complete period. */
  elapsedDays: number;
  /** Days the period will contain in total. */
  totalDays: number;
}

const MS_PER_DAY = 86_400_000;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------------------------------------------------------------------------
// UTC date helpers
// ---------------------------------------------------------------------------

export function utcStartOfDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function utcStartOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function utcAddMonths(d: Date, months: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()),
  );
}

export function utcAddDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function buildPeriod(
  start: Date,
  end: Date,
  kind: PeriodKind,
  label: string,
  now: Date,
): Period {
  const totalDays = Math.max(1, daysBetween(start, end));
  const isPartial = end > now;
  // Count whole days: `now` is a moment inside the current day, and counting
  // the part-day as a fraction would make "15 days elapsed" read as 16.
  const elapsedDays = isPartial
    ? Math.max(0, Math.min(totalDays, daysBetween(start, utcStartOfDay(now)) + 1))
    : totalDays;
  return { start, end, kind, label, isPartial, elapsedDays, totalDays };
}

// ---------------------------------------------------------------------------
// Calendar periods
// ---------------------------------------------------------------------------

/**
 * A calendar month, quarter or year. `offset` counts backwards: 0 is the
 * current one, -1 the previous.
 */
export function calendarPeriod(
  unit: CalendarUnit,
  now: Date = new Date(),
  offset = 0,
): Period {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  if (unit === "month") {
    const start = new Date(Date.UTC(y, m + offset, 1));
    const end = new Date(Date.UTC(y, m + offset + 1, 1));
    const label = `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
    return buildPeriod(start, end, "calendar", label, now);
  }

  if (unit === "quarter") {
    const currentQuarter = Math.floor(m / 3);
    const start = new Date(Date.UTC(y, (currentQuarter + offset) * 3, 1));
    const end = new Date(Date.UTC(y, (currentQuarter + offset) * 3 + 3, 1));
    const q = Math.floor(start.getUTCMonth() / 3) + 1;
    return buildPeriod(
      start,
      end,
      "calendar",
      `Q${q} ${start.getUTCFullYear()}`,
      now,
    );
  }

  const start = new Date(Date.UTC(y + offset, 0, 1));
  const end = new Date(Date.UTC(y + offset + 1, 0, 1));
  return buildPeriod(start, end, "calendar", `${start.getUTCFullYear()}`, now);
}

/** Year to date: 1 January through now. Always partial except on 31 December. */
export function yearToDate(now: Date = new Date()): Period {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const end = utcAddDays(utcStartOfDay(now), 1);
  return buildPeriod(start, end, "calendar", `${now.getUTCFullYear()} to date`, now);
}

// ---------------------------------------------------------------------------
// Rolling periods
// ---------------------------------------------------------------------------

/**
 * The last `days` days ending today inclusive. Labelled "Last N days" and
 * never "this month" — the distinction is the whole point.
 */
export function rollingPeriod(days: number, now: Date = new Date()): Period {
  const end = utcAddDays(utcStartOfDay(now), 1);
  const start = utcAddDays(end, -days);
  return buildPeriod(start, end, "rolling", `Last ${days} days`, now);
}

/** The rolling window of the same length immediately before `period`. */
export function previousPeriod(period: Period): Period {
  const lengthMs = period.end.getTime() - period.start.getTime();
  const start = new Date(period.start.getTime() - lengthMs);
  const end = new Date(period.start.getTime());

  if (period.kind === "calendar") {
    // Step whole months so February compares against January, not "the 28 days
    // before February".
    const prevStart = new Date(
      Date.UTC(
        period.start.getUTCFullYear(),
        period.start.getUTCMonth() - monthSpan(period),
        1,
      ),
    );
    return buildPeriod(
      prevStart,
      period.start,
      "calendar",
      labelForCalendarStart(prevStart, monthSpan(period)),
      period.start,
    );
  }

  return buildPeriod(start, end, period.kind, `Previous ${period.label.toLowerCase()}`, end);
}

function monthSpan(period: Period): number {
  const months =
    (period.end.getUTCFullYear() - period.start.getUTCFullYear()) * 12 +
    (period.end.getUTCMonth() - period.start.getUTCMonth());
  return Math.max(1, months);
}

function labelForCalendarStart(start: Date, span: number): string {
  if (span === 1) {
    return `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  if (span === 3) {
    return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`;
  }
  return `${start.getUTCFullYear()}`;
}

/**
 * The equivalent slice of a prior period, for comparing a partial month
 * against the same number of days of the month before. Without this, a month
 * that is 12 days old always looks like a dramatic fall.
 */
export function comparableSlice(period: Period): Period {
  const previous = previousPeriod(period);
  if (!period.isPartial) return previous;
  const end = utcAddDays(previous.start, period.elapsedDays);
  return buildPeriod(
    previous.start,
    end > previous.end ? previous.end : end,
    previous.kind,
    `${previous.label} (first ${period.elapsedDays} days)`,
    previous.end,
  );
}

// ---------------------------------------------------------------------------
// Paycheck periods
// ---------------------------------------------------------------------------

export interface PaycheckEvent {
  date: Date;
  amount: number;
}

export interface PaycheckCadence {
  /** Median days between deposits. */
  medianGapDays: number;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly" | "irregular";
  /** Median deposit amount — robust against a bonus. */
  medianAmount: number;
  /** Expected number of deposits in a calendar month at this cadence. */
  expectedPerMonth: number;
}

/**
 * Infers pay cadence from deposit history. Uses medians throughout: this
 * user's mean deposit is $3,199 because of a single $20,170 December bonus,
 * while the median is $2,565.72, which is the actual paycheck.
 */
export function inferPaycheckCadence(
  events: PaycheckEvent[],
): PaycheckCadence | null {
  if (events.length < 3) return null;

  const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1].date, sorted[i].date);
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;

  const medianGapDays = median(gaps);
  const medianAmount = median(sorted.map((e) => Math.abs(e.amount)));

  let frequency: PaycheckCadence["frequency"];
  let expectedPerMonth: number;
  if (medianGapDays <= 8) {
    frequency = "weekly";
    expectedPerMonth = 52 / 12;
  } else if (medianGapDays <= 16) {
    frequency = "biweekly";
    expectedPerMonth = 26 / 12;
  } else if (medianGapDays <= 18) {
    frequency = "semimonthly";
    expectedPerMonth = 2;
  } else if (medianGapDays <= 33) {
    frequency = "monthly";
    expectedPerMonth = 1;
  } else {
    frequency = "irregular";
    expectedPerMonth = 30 / medianGapDays;
  }

  return { medianGapDays, frequency, medianAmount, expectedPerMonth };
}

/**
 * The span from the most recent paycheck up to the next expected one. This is
 * the window a biweekly earner actually budgets within, and the correct basis
 * for "safe to spend".
 */
export function paycheckPeriod(
  events: PaycheckEvent[],
  now: Date = new Date(),
): Period | null {
  const cadence = inferPaycheckCadence(events);
  if (!cadence) return null;

  const past = events
    .filter((e) => e.date <= now)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  if (past.length === 0) return null;

  const start = utcStartOfDay(past[0].date);
  const end = utcAddDays(start, Math.round(cadence.medianGapDays));
  return buildPeriod(start, end, "paycheck", "Since last paycheck", now);
}

/**
 * How many paychecks a calendar period should contain, so a three-payday month
 * can be explained rather than reported as a windfall.
 */
export function expectedPaychecks(period: Period, cadence: PaycheckCadence): number {
  return Math.round((period.totalDays / 30.44) * cadence.expectedPerMonth);
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** The month starts covered by a period, oldest first. Used for monthly series. */
export function monthsIn(period: Period): Date[] {
  const out: Date[] = [];
  let cursor = utcStartOfMonth(period.start);
  while (cursor < period.end) {
    out.push(cursor);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return out;
}

/** The last `count` complete calendar months before the current one. */
export function trailingMonths(count: number, now: Date = new Date()): Period {
  const end = utcStartOfMonth(now);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - count, 1));
  return buildPeriod(start, end, "calendar", `Last ${count} months`, now);
}
