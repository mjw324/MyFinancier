/**
 * The value contract for everything the chat assistant reads (tool outputs and
 * the snapshot). The model never does arithmetic, so every figure arrives
 * finished:
 *   - money as integer cents plus the display string the user should read
 *   - changes with a pre-computed delta and pctChange (null on a small base)
 *   - date ranges resolved in the user's time zone and echoed back
 *   - lists with count / truncated, and an asOf for posting lag
 */

import { z } from "zod";
import { computeDelta } from "@/lib/analytics/trends";
import { formatRatio, formatSignedRatio } from "@/lib/analytics/labels";
import { utcAddDays, type Period } from "@/lib/analytics/periods";
import { parseDateParam, toDateParam } from "@/lib/utils/date-ranges";
import { formatCurrency } from "@/lib/utils/format";
import { PERIOD_PRESETS, presetPeriod } from "@/lib/transactions/nl-search";

export interface Money {
  cents: number;
  display: string;
}

/** Dollars (already rounded to cents by the metrics) → the money contract. */
export function money(dollars: number): Money {
  const cents = Math.round(dollars * 100);
  return { cents, display: formatCurrency(cents / 100) };
}

export interface Percent {
  /** Whole percent, as displayed. */
  value: number;
  display: string;
}

export function percent(ratio: number): Percent {
  return { value: Math.round(Math.abs(ratio) * 100), display: formatRatio(ratio) };
}

export interface Change {
  /** current − previous */
  delta: Money;
  /** Whole percent, signed; null when the base is too small for a percent to mean anything. */
  pctChange: number | null;
  pctChangeDisplay: string | null;
  direction: "up" | "down" | "flat";
}

export function change(current: number, previous: number): Change {
  const d = computeDelta(current, previous);
  return {
    delta: money(d.absolute),
    pctChange: d.ratio === null ? null : Math.round(d.ratio * 100),
    pctChangeDisplay: d.ratio === null ? null : formatSignedRatio(d.ratio),
    direction: d.direction,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** How a tool asks for a period: a preset, or explicit inclusive dates. */
export const RangeSchema = z
  .union([
    z.object({ preset: z.enum(PERIOD_PRESETS) }).strict(),
    z.object({ from: isoDate, to: isoDate }).strict().describe("Inclusive YYYY-MM-DD dates"),
  ])
  .describe("A preset period, or from/to dates. Resolved in the user's time zone.");
export type RangeInput = z.infer<typeof RangeSchema>;

export interface ResolvedRange {
  /** Inclusive YYYY-MM-DD. */
  from: string;
  /** Inclusive YYYY-MM-DD. */
  to: string;
  label: string;
  /** True when the range runs past today: totals are not final. */
  isPartial: boolean;
  days: number;
  timeZone: string;
}

const MAX_RANGE_DAYS = 3 * 366;

/**
 * Resolve a range against the user's calendar date. Returns the period for
 * queries ([start, end) UTC midnights) and the echo for the output, or an
 * error string the model can act on.
 */
export function resolveRange(
  input: RangeInput,
  today: Date,
  timeZone: string,
): { period: Pick<Period, "start" | "end">; range: ResolvedRange } | { error: string } {
  let start: Date;
  let end: Date;
  let label: string;
  if ("preset" in input) {
    const p = presetPeriod(input.preset, today);
    ({ start, end, label } = p);
  } else {
    const from = parseDateParam(input.from);
    const to = parseDateParam(input.to);
    if (!from || !to) return { error: "from and to must be real dates as YYYY-MM-DD." };
    const [a, b] = from <= to ? [from, to] : [to, from];
    start = a;
    end = utcAddDays(b, 1);
    label = `${toDateParam(a)} to ${toDateParam(b)}`;
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) return { error: "Ranges are limited to three years. Ask for a shorter period." };
  return {
    period: { start, end },
    range: {
      from: toDateParam(start),
      to: toDateParam(utcAddDays(end, -1)),
      label,
      isPartial: end > utcAddDays(today, 1) || toDateParam(utcAddDays(end, -1)) === toDateParam(today),
      days,
      timeZone,
    },
  };
}
