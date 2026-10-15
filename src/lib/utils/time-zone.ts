/**
 * Time-zone helpers (pure, safe on server and client).
 *
 * Transaction dates are calendar dates stored as UTC-midnight timestamps, and
 * the server runs in UTC. "Today" must be the user's calendar date, not the
 * server's: at 9pm in New York the server is already on tomorrow.
 */

export const TIME_ZONE_COOKIE = "tz";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar date `now` falls on in `timeZone`, as a UTC-midnight Date —
 * the same representation transaction dates use. Pass the result as the
 * `now` argument of the period helpers in src/lib/analytics/periods.ts.
 */
export function calendarDateInTimeZone(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}
