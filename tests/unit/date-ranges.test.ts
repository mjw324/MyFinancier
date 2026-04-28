import { describe, it, expect } from "vitest";
import {
  getDateRange,
  getPreviousDateRange,
} from "@/lib/utils/date-ranges";

// Fixed reference: Wednesday, April 15 2026 14:30:00 local time.
const NOW = new Date(2026, 3, 15, 14, 30, 0, 0);

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;

describe("getDateRange (current period)", () => {
  it('"week" spans 7 days ending at now, starting at midnight', () => {
    const { start, end } = getDateRange("week", NOW);
    expect(end).toBe(NOW); // identity preserved
    expect(iso(start)).toBe("2026-04-09 00:00:00.000");
  });

  it('"month" spans 30 days ending at now', () => {
    const { start, end } = getDateRange("month", NOW);
    expect(end).toBe(NOW);
    expect(iso(start)).toBe("2026-03-17 00:00:00.000");
  });

  it('"year" spans 365 days ending at now', () => {
    const { start, end } = getDateRange("year", NOW);
    expect(end).toBe(NOW);
    // start = now minus a year plus 1 day
    expect(iso(start)).toBe("2025-04-16 00:00:00.000");
  });

  it('"ytd" starts at Jan 1 of current year', () => {
    const { start, end } = getDateRange("ytd", NOW);
    expect(end).toBe(NOW);
    expect(iso(start)).toBe("2026-01-01 00:00:00.000");
  });

  it("does not mutate the input `now`", () => {
    const before = NOW.getTime();
    getDateRange("week", NOW);
    getDateRange("month", NOW);
    getDateRange("year", NOW);
    getDateRange("ytd", NOW);
    expect(NOW.getTime()).toBe(before);
  });
});

describe("getPreviousDateRange (delta comparison period)", () => {
  it('"week" prior period: 7 days before current week', () => {
    const { start, end } = getPreviousDateRange("week", NOW);
    expect(iso(end)).toBe("2026-04-08 23:59:59.999");
    expect(iso(start)).toBe("2026-04-02 00:00:00.000");
  });

  it('"month" prior period: 30 days before current month', () => {
    const { start, end } = getPreviousDateRange("month", NOW);
    expect(iso(end)).toBe("2026-03-16 23:59:59.999");
    expect(iso(start)).toBe("2026-02-15 00:00:00.000");
  });

  it('"year" prior period: previous 365-day window', () => {
    const { start, end } = getPreviousDateRange("year", NOW);
    expect(iso(end)).toBe("2025-04-15 23:59:59.999");
    expect(iso(start)).toBe("2024-04-16 00:00:00.000");
  });

  it('"ytd" prior period: same range, prior year', () => {
    const { start, end } = getPreviousDateRange("ytd", NOW);
    expect(iso(start)).toBe("2025-01-01 00:00:00.000");
    expect(iso(end)).toBe("2025-04-15 23:59:59.999");
  });
});

describe("date-range edge cases", () => {
  it("YTD on Jan 1 yields a zero-length window", () => {
    const newYearsDay = new Date(2026, 0, 1, 9, 0, 0, 0);
    const { start, end } = getDateRange("ytd", newYearsDay);
    expect(start.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(iso(start)).toBe("2026-01-01 00:00:00.000");
  });

  it("week boundary handles month rollover", () => {
    // Jan 3 → start should be Dec 28 of previous year
    const earlyJan = new Date(2026, 0, 3, 12, 0, 0, 0);
    const { start } = getDateRange("week", earlyJan);
    expect(iso(start)).toBe("2025-12-28 00:00:00.000");
  });
});
