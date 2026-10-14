/**
 * Budget periods (pure, UTC calendar dates).
 *
 * A budget repeats from its start date: a monthly budget starting on the 15th
 * runs 15th → 14th; one starting on the 1st follows calendar months. Bounds
 * are half-open — `date >= start AND date < end` — so a transaction on the
 * boundary day belongs to exactly one period. An end date is the last day the
 * budget applies (inclusive).
 *
 * `today` is the viewer's calendar date (getUserToday), never the server's.
 */

import type { BudgetPeriod } from "@/lib/db/schema/budgets";

export type { BudgetPeriod };

export type BudgetWindowState = "active" | "upcoming" | "ended";

export interface BudgetWindow {
  /** First day (UTC midnight). */
  start: Date;
  /** Exclusive bound (UTC midnight of the day after the last day). */
  end: Date;
  /** Last day included (UTC midnight). */
  lastDay: Date;
  state: BudgetWindowState;
  /** 0-based index of this period since the budget started. */
  index: number;
  /** Days remaining including today (active periods only, else 0). */
  daysLeft: number;
  /** e.g. "Oct 1 – Oct 31". */
  label: string;
}

const MS_PER_DAY = 86_400_000;

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function addMonthsClamped(anchor: Date, months: number): Date {
  const target = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), last)));
}

/** Start of the k-th period after `anchor`. */
export function periodStart(period: BudgetPeriod, anchor: Date, k: number): Date {
  switch (period) {
    case "weekly":
      return addDays(anchor, 7 * k);
    case "yearly":
      return addMonthsClamped(anchor, 12 * k);
    case "monthly":
    default:
      return addMonthsClamped(anchor, k);
  }
}

/** Index of the period that contains `day` (day >= anchor). */
function periodIndex(period: BudgetPeriod, anchor: Date, day: Date): number {
  let k: number;
  if (period === "weekly") {
    k = Math.floor((day.getTime() - anchor.getTime()) / (7 * MS_PER_DAY));
  } else {
    const months =
      (day.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      (day.getUTCMonth() - anchor.getUTCMonth());
    k = period === "yearly" ? Math.floor(months / 12) : months;
  }
  k = Math.max(0, k);
  while (k > 0 && periodStart(period, anchor, k) > day) k--;
  while (periodStart(period, anchor, k + 1) <= day) k++;
  return k;
}

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

export function resolveBudgetWindow(
  budget: { period: BudgetPeriod; startDate: Date; endDate: Date | null },
  today: Date,
): BudgetWindow {
  const anchor = utcDay(budget.startDate);
  const day = utcDay(today);
  const hardEnd = budget.endDate ? addDays(utcDay(budget.endDate), 1) : null;

  let state: BudgetWindowState;
  let k: number;
  if (day < anchor) {
    state = "upcoming";
    k = 0;
  } else if (hardEnd && day >= hardEnd) {
    state = "ended";
    k = periodIndex(budget.period, anchor, addDays(hardEnd, -1));
  } else {
    state = "active";
    k = periodIndex(budget.period, anchor, day);
  }

  const start = periodStart(budget.period, anchor, k);
  const natural = periodStart(budget.period, anchor, k + 1);
  const end = hardEnd && hardEnd < natural ? hardEnd : natural;
  const lastDay = addDays(end, -1);
  const daysLeft =
    state === "active" ? Math.round((end.getTime() - day.getTime()) / MS_PER_DAY) : 0;

  return {
    start,
    end,
    lastDay,
    state,
    index: k,
    daysLeft,
    label: `${fmt.format(start)} – ${fmt.format(lastDay)}`,
  };
}

/**
 * Sensible default first day for a new budget: the 1st of this month, the
 * Monday of this week, or 1 January — so periods follow the calendar unless
 * the user picks another anchor.
 */
export function defaultBudgetStart(period: BudgetPeriod, today: Date): Date {
  const day = utcDay(today);
  if (period === "weekly") {
    const dow = day.getUTCDay(); // 0 = Sunday
    return addDays(day, -((dow + 6) % 7));
  }
  if (period === "yearly") return new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

export function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
