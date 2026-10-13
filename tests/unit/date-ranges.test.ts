import { describe, expect, it } from "vitest";
import {
  dashboardPeriodSchema,
  parseDateParam,
  periodToRange,
  resolveDashboardPeriod,
  toDateParam,
  transactionsHref,
} from "@/lib/utils/date-ranges";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("resolveDashboardPeriod", () => {
  const today = day("2026-10-13");

  it("this month is the calendar month, partial, N of M days", () => {
    const p = resolveDashboardPeriod("month", today);
    expect(p.label).toBe("October 2026");
    expect(toDateParam(p.start)).toBe("2026-10-01");
    expect(toDateParam(p.end)).toBe("2026-11-01");
    expect(p.isPartial).toBe(true);
    expect([p.elapsedDays, p.totalDays]).toEqual([13, 31]);
  });

  it("last month is complete", () => {
    const p = resolveDashboardPeriod("last-month", today);
    expect(p.label).toBe("September 2026");
    expect(p.isPartial).toBe(false);
    expect(periodToRange(p)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("last 30 days ends today inclusive and is never called a month", () => {
    const p = resolveDashboardPeriod("30d", today);
    expect(p.label).toBe("Last 30 days");
    expect(periodToRange(p)).toEqual({ from: "2026-09-14", to: "2026-10-13" });
  });

  it("year to date starts on 1 January", () => {
    const p = resolveDashboardPeriod("ytd", today);
    expect(periodToRange(p)).toEqual({ from: "2026-01-01", to: "2026-10-13" });
  });

  it("falls back to this month for unknown keys", () => {
    expect(dashboardPeriodSchema.parse("garbage")).toBe("month");
    expect(dashboardPeriodSchema.parse(undefined)).toBe("month");
    expect(dashboardPeriodSchema.parse("ytd")).toBe("ytd");
  });
});

describe("parseDateParam", () => {
  it("accepts real calendar dates as UTC midnight", () => {
    expect(parseDateParam("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("rejects garbage and impossible dates instead of producing Invalid Date", () => {
    for (const bad of ["garbage", "2026-02-30", "2026-13-01", "26-01-01", "", null, undefined]) {
      expect(parseDateParam(bad as string)).toBeNull();
    }
  });
});

describe("transactionsHref", () => {
  it("drops empty values and encodes the rest", () => {
    expect(
      transactionsHref({ from: "2026-08-01", to: "2026-08-31", bucket: "FOOD_AND_DRINK", category: "" }),
    ).toBe("/transactions?from=2026-08-01&to=2026-08-31&bucket=FOOD_AND_DRINK");
    expect(transactionsHref({ counterparty: "coffee & co" })).toBe(
      "/transactions?counterparty=coffee+%26+co",
    );
  });
});
