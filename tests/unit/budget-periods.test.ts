import { describe, it, expect } from "vitest";
import {
  defaultBudgetStart,
  resolveBudgetWindow,
  toYmd,
} from "@/lib/utils/budget-periods";

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function win(
  period: "weekly" | "monthly" | "yearly",
  start: string,
  today: string,
  end: string | null = null,
) {
  const w = resolveBudgetWindow(
    { period, startDate: d(start), endDate: end ? d(end) : null },
    d(today),
  );
  return { start: toYmd(w.start), end: toYmd(w.end), last: toYmd(w.lastDay), state: w.state, daysLeft: w.daysLeft };
}

describe("resolveBudgetWindow (verify-calcs 6.3)", () => {
  it("monthly from the 1st follows calendar months, half-open", () => {
    expect(win("monthly", "2026-01-01", "2026-04-15")).toEqual({
      start: "2026-04-01",
      end: "2026-05-01",
      last: "2026-04-30",
      state: "active",
      daysLeft: 16,
    });
    // The boundary day belongs to the new period only.
    expect(win("monthly", "2026-01-01", "2026-05-01").start).toBe("2026-05-01");
  });

  it("monthly honours a mid-month anchor", () => {
    expect(win("monthly", "2026-01-15", "2026-04-10")).toMatchObject({
      start: "2026-03-15",
      end: "2026-04-15",
    });
    expect(win("monthly", "2026-01-15", "2026-04-15").start).toBe("2026-04-15");
  });

  it("monthly anchored on the 31st clamps short months from the anchor, not cumulatively", () => {
    expect(win("monthly", "2026-01-31", "2026-03-01")).toMatchObject({
      start: "2026-02-28",
      end: "2026-03-31",
    });
    expect(win("monthly", "2026-01-31", "2026-04-05")).toMatchObject({
      start: "2026-03-31",
      end: "2026-04-30",
    });
  });

  it("weekly repeats every 7 days from the start weekday", () => {
    // 2026-08-07 is a Friday.
    expect(win("weekly", "2026-08-07", "2026-08-20")).toMatchObject({
      start: "2026-08-14",
      end: "2026-08-21",
      daysLeft: 1,
    });
  });

  it("yearly repeats from the anchor date", () => {
    expect(win("yearly", "2025-07-01", "2026-03-01")).toMatchObject({
      start: "2025-07-01",
      end: "2026-07-01",
    });
  });

  it("before the start date the first period is upcoming", () => {
    expect(win("monthly", "2026-09-01", "2026-08-20")).toMatchObject({
      start: "2026-09-01",
      state: "upcoming",
      daysLeft: 0,
    });
  });

  it("an end date caps the last period and ends the budget", () => {
    expect(win("monthly", "2026-01-01", "2026-03-10", "2026-03-20")).toMatchObject({
      start: "2026-03-01",
      end: "2026-03-21",
      last: "2026-03-20",
      state: "active",
    });
    expect(win("monthly", "2026-01-01", "2026-06-10", "2026-03-20")).toMatchObject({
      start: "2026-03-01",
      last: "2026-03-20",
      state: "ended",
    });
    // The end date itself is still inside the budget.
    expect(win("monthly", "2026-01-01", "2026-03-20", "2026-03-20").state).toBe("active");
  });
});

describe("defaultBudgetStart", () => {
  it("defaults to calendar boundaries", () => {
    expect(toYmd(defaultBudgetStart("monthly", d("2026-10-13")))).toBe("2026-10-01");
    expect(toYmd(defaultBudgetStart("yearly", d("2026-10-13")))).toBe("2026-01-01");
    // 2026-10-13 is a Tuesday → Monday 2026-10-12; a Sunday maps back 6 days.
    expect(toYmd(defaultBudgetStart("weekly", d("2026-10-13")))).toBe("2026-10-12");
    expect(toYmd(defaultBudgetStart("weekly", d("2026-10-18")))).toBe("2026-10-12");
  });
});
