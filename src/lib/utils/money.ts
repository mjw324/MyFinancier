/**
 * Money arithmetic.
 *
 * Amounts are stored as Postgres `numeric`, which is exact decimal, but they
 * arrive in JavaScript as strings and become floats the moment they are
 * parsed. Summing floats reintroduces the error `numeric` exists to avoid:
 * 0.10 + 0.20 is 0.30000000000000004, which surfaced as a net worth off by a
 * fraction of a cent and a failing precision test.
 *
 * Round the aggregate, not each term, so repeated rounding cannot accumulate
 * its own drift.
 */

/** Rounds to cents, correcting for the representation error in values like
 *  1.005 that would otherwise round down. */
export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sums money values and rounds once at the end. */
export function sumMoney(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return roundMoney(total);
}

/** Parses a `numeric` column into a number, treating anything unusable as 0. */
export function parseMoney(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/** Parses and sums a column of `numeric` values in one step. */
export function sumMoneyStrings(
  values: Array<string | number | null | undefined>,
): number {
  return sumMoney(values.map(parseMoney));
}
