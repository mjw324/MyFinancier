import { describe, it, expect } from "vitest";
import {
  calendarPeriod,
  rollingPeriod,
  previousPeriod,
  comparableSlice,
  yearToDate,
  trailingMonths,
  monthsIn,
  inferPaycheckCadence,
  paycheckPeriod,
  expectedPaychecks,
  median,
  utcStartOfMonth,
  utcAddDays,
} from "@/lib/analytics/periods";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Mid-August 2026, matching the reference data's "current month".
const MID_AUGUST = new Date("2026-08-15T12:00:00Z");
const END_AUGUST = new Date("2026-09-01T00:00:00Z");

describe("calendarPeriod", () => {
  it("bounds a month with an exclusive end so no row is double-counted", () => {
    const p = calendarPeriod("month", MID_AUGUST);
    expect(iso(p.start)).toBe("2026-08-01");
    expect(iso(p.end)).toBe("2026-09-01");
    expect(p.label).toBe("August 2026");
  });

  it("marks the current month partial and counts elapsed days", () => {
    const p = calendarPeriod("month", MID_AUGUST);
    expect(p.isPartial).toBe(true);
    expect(p.totalDays).toBe(31);
    expect(p.elapsedDays).toBe(15);
  });

  it("marks a finished month complete", () => {
    const p = calendarPeriod("month", END_AUGUST, -1);
    expect(p.label).toBe("August 2026");
    expect(p.isPartial).toBe(false);
    expect(p.elapsedDays).toBe(31);
  });

  it("walks backwards across a year boundary", () => {
    const p = calendarPeriod("month", new Date("2026-01-15T00:00:00Z"), -1);
    expect(iso(p.start)).toBe("2025-12-01");
    expect(p.label).toBe("December 2025");
  });

  it("bounds quarters and years", () => {
    const q = calendarPeriod("quarter", MID_AUGUST);
    expect(iso(q.start)).toBe("2026-07-01");
    expect(iso(q.end)).toBe("2026-10-01");
    expect(q.label).toBe("Q3 2026");

    const y = calendarPeriod("year", MID_AUGUST);
    expect(iso(y.start)).toBe("2026-01-01");
    expect(iso(y.end)).toBe("2027-01-01");
  });

  it("uses UTC boundaries regardless of the host timezone", () => {
    // A UTC-midnight timestamp must fall inside its own month even when the
    // process runs behind UTC.
    const p = calendarPeriod("month", new Date("2026-08-01T00:00:00Z"));
    expect(p.start.getTime()).toBe(Date.parse("2026-08-01T00:00:00Z"));
  });
});

describe("rollingPeriod", () => {
  it("covers exactly N days ending today inclusive", () => {
    const p = rollingPeriod(30, MID_AUGUST);
    expect(p.totalDays).toBe(30);
    expect(iso(p.start)).toBe("2026-07-17");
    expect(iso(p.end)).toBe("2026-08-16");
  });

  it("is labelled by day count, never as a month", () => {
    // The current dashboard calls this "this month", which is the source of
    // two different spans appearing on one card.
    expect(rollingPeriod(30, MID_AUGUST).label).toBe("Last 30 days");
    expect(rollingPeriod(30, MID_AUGUST).kind).toBe("rolling");
  });

  it("counts every day in the window as elapsed but flags today as unfinished", () => {
    // The window ends at the end of today, which has not happened yet, so the
    // last day is still accumulating even though all N days are in scope.
    const p = rollingPeriod(7, MID_AUGUST);
    expect(p.elapsedDays).toBe(7);
    expect(p.totalDays).toBe(7);
    expect(p.isPartial).toBe(true);
  });
});

describe("previousPeriod", () => {
  it("steps a calendar month back a whole month, not a fixed day count", () => {
    const august = calendarPeriod("month", END_AUGUST, -1);
    const july = previousPeriod(august);
    expect(iso(july.start)).toBe("2026-07-01");
    expect(iso(july.end)).toBe("2026-08-01");
    expect(july.label).toBe("July 2026");
    expect(july.totalDays).toBe(31);
  });

  it("handles February correctly rather than subtracting 28 days", () => {
    const march = calendarPeriod("month", new Date("2026-04-01T00:00:00Z"), -1);
    const february = previousPeriod(march);
    expect(iso(february.start)).toBe("2026-02-01");
    expect(february.totalDays).toBe(28);
  });

  it("steps a rolling window back by its own length", () => {
    const p = rollingPeriod(30, MID_AUGUST);
    const prev = previousPeriod(p);
    expect(prev.totalDays).toBe(30);
    expect(prev.end.getTime()).toBe(p.start.getTime());
  });

  it("steps a quarter back three months", () => {
    const q = calendarPeriod("quarter", new Date("2026-10-01T00:00:00Z"), -1);
    const prev = previousPeriod(q);
    expect(iso(prev.start)).toBe("2026-04-01");
    expect(prev.label).toBe("Q2 2026");
  });
});

describe("comparableSlice", () => {
  it("truncates the prior month to the elapsed days of a partial month", () => {
    // Comparing 15 days of August against all 31 days of July always shows a
    // fall that has not happened.
    const august = calendarPeriod("month", MID_AUGUST);
    const slice = comparableSlice(august);
    expect(iso(slice.start)).toBe("2026-07-01");
    expect(iso(slice.end)).toBe("2026-07-16");
    expect(slice.totalDays).toBe(15);
    expect(slice.label).toContain("first 15 days");
  });

  it("returns the whole prior period when the current one is complete", () => {
    const august = calendarPeriod("month", END_AUGUST, -1);
    const slice = comparableSlice(august);
    expect(iso(slice.start)).toBe("2026-07-01");
    expect(iso(slice.end)).toBe("2026-08-01");
  });

  it("never runs past the end of the prior period", () => {
    // A 31-day month partway through compared to a 28-day February.
    const march = calendarPeriod("month", new Date("2026-03-30T12:00:00Z"));
    const slice = comparableSlice(march);
    expect(slice.end.getTime()).toBeLessThanOrEqual(
      Date.parse("2026-03-01T00:00:00Z"),
    );
  });
});

describe("yearToDate and trailingMonths", () => {
  it("runs year to date from 1 January through today", () => {
    const p = yearToDate(MID_AUGUST);
    expect(iso(p.start)).toBe("2026-01-01");
    expect(iso(p.end)).toBe("2026-08-16");
  });

  it("returns complete months only for trailing windows", () => {
    const p = trailingMonths(6, MID_AUGUST);
    expect(iso(p.start)).toBe("2026-02-01");
    expect(iso(p.end)).toBe("2026-08-01");
    expect(p.isPartial).toBe(false);
  });

  it("enumerates the months a period covers", () => {
    const months = monthsIn(trailingMonths(3, MID_AUGUST)).map(iso);
    expect(months).toEqual(["2026-05-01", "2026-06-01", "2026-07-01"]);
  });
});

describe("inferPaycheckCadence", () => {
  // The reference user's real deposit history: biweekly, with a December bonus
  // that makes the mean useless.
  const biweekly = [
    { date: new Date("2026-06-12T00:00:00Z"), amount: -2565.57 },
    { date: new Date("2026-06-26T00:00:00Z"), amount: -2565.49 },
    { date: new Date("2026-07-10T00:00:00Z"), amount: -2565.72 },
    { date: new Date("2026-07-24T00:00:00Z"), amount: -2565.72 },
    { date: new Date("2026-08-07T00:00:00Z"), amount: -2565.72 },
    { date: new Date("2026-08-21T00:00:00Z"), amount: -2565.72 },
  ];

  it("detects a biweekly cadence", () => {
    const c = inferPaycheckCadence(biweekly)!;
    expect(c.medianGapDays).toBe(14);
    expect(c.frequency).toBe("biweekly");
    expect(c.expectedPerMonth).toBeCloseTo(26 / 12, 4);
  });

  it("reports the median deposit so a bonus cannot distort it", () => {
    const withBonus = [
      ...biweekly,
      { date: new Date("2025-12-12T00:00:00Z"), amount: -20169.56 },
    ];
    const c = inferPaycheckCadence(withBonus)!;
    expect(c.medianAmount).toBeCloseTo(2565.72, 2);
    const mean =
      withBonus.reduce((s, e) => s + Math.abs(e.amount), 0) / withBonus.length;
    expect(mean).toBeGreaterThan(5000);
  });

  it("detects monthly and weekly cadences", () => {
    const monthly = [
      { date: new Date("2026-06-01T00:00:00Z"), amount: -5000 },
      { date: new Date("2026-07-01T00:00:00Z"), amount: -5000 },
      { date: new Date("2026-08-01T00:00:00Z"), amount: -5000 },
    ];
    expect(inferPaycheckCadence(monthly)!.frequency).toBe("monthly");

    const weekly = [
      { date: new Date("2026-08-01T00:00:00Z"), amount: -800 },
      { date: new Date("2026-08-08T00:00:00Z"), amount: -800 },
      { date: new Date("2026-08-15T00:00:00Z"), amount: -800 },
    ];
    expect(inferPaycheckCadence(weekly)!.frequency).toBe("weekly");
  });

  it("returns null when there is too little history to infer anything", () => {
    expect(inferPaycheckCadence([])).toBeNull();
    expect(
      inferPaycheckCadence([{ date: new Date("2026-08-01T00:00:00Z"), amount: -100 }]),
    ).toBeNull();
  });
});

describe("expectedPaychecks", () => {
  const cadence = inferPaycheckCadence([
    { date: new Date("2026-07-10T00:00:00Z"), amount: -2565 },
    { date: new Date("2026-07-24T00:00:00Z"), amount: -2565 },
    { date: new Date("2026-08-07T00:00:00Z"), amount: -2565 },
    { date: new Date("2026-08-21T00:00:00Z"), amount: -2565 },
  ])!;

  it("expects two paychecks in a typical month", () => {
    const august = calendarPeriod("month", END_AUGUST, -1);
    expect(expectedPaychecks(august, cadence)).toBe(2);
  });

  it("explains a three-payday month instead of reporting a windfall", () => {
    // May 2026 genuinely contained three deposits; income did not rise 50%.
    const may = calendarPeriod("month", new Date("2026-06-01T00:00:00Z"), -1);
    const expected = expectedPaychecks(may, cadence);
    const actual = 3;
    expect(expected).toBe(2);
    expect(actual).toBeGreaterThan(expected);
  });
});

describe("paycheckPeriod", () => {
  it("spans from the last paycheck to the next expected one", () => {
    const events = [
      { date: new Date("2026-07-24T00:00:00Z"), amount: -2565.72 },
      { date: new Date("2026-08-07T00:00:00Z"), amount: -2565.72 },
      { date: new Date("2026-08-21T00:00:00Z"), amount: -2565.72 },
    ];
    const p = paycheckPeriod(events, new Date("2026-08-25T00:00:00Z"))!;
    expect(iso(p.start)).toBe("2026-08-21");
    expect(iso(p.end)).toBe("2026-09-04");
    expect(p.kind).toBe("paycheck");
    expect(p.isPartial).toBe(true);
  });

  it("ignores deposits in the future when picking the anchor", () => {
    const events = [
      { date: new Date("2026-08-07T00:00:00Z"), amount: -2565.72 },
      { date: new Date("2026-08-21T00:00:00Z"), amount: -2565.72 },
      { date: new Date("2026-09-04T00:00:00Z"), amount: -2565.72 },
    ];
    const p = paycheckPeriod(events, new Date("2026-08-25T00:00:00Z"))!;
    expect(iso(p.start)).toBe("2026-08-21");
  });

  it("returns null without enough history", () => {
    expect(paycheckPeriod([], MID_AUGUST)).toBeNull();
  });
});

describe("median", () => {
  it("returns the middle value for an odd count", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is unmoved by an extreme outlier", () => {
    expect(median([100, 100, 100, 100, 20000])).toBe(100);
  });

  it("returns 0 for an empty set", () => {
    expect(median([])).toBe(0);
  });
});

describe("utc helpers", () => {
  it("floors to the first of the month in UTC", () => {
    expect(iso(utcStartOfMonth(new Date("2026-08-31T23:59:59Z")))).toBe("2026-08-01");
  });

  it("adds days without drifting across a DST boundary", () => {
    // 8 March 2026 is a US DST transition; UTC arithmetic must be unaffected.
    const d = utcAddDays(new Date("2026-03-07T00:00:00Z"), 2);
    expect(iso(d)).toBe("2026-03-09");
    expect(d.getUTCHours()).toBe(0);
  });
});
