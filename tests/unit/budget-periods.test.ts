import { describe, it, expect } from "vitest";
import { getPeriodStart, getPeriodEnd } from "@/lib/utils/budget-periods";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

const BUDGET_START = new Date(2024, 0, 1, 0, 0, 0);

describe("getPeriodStart", () => {
  it('"monthly" returns the 1st of the current month', () => {
    const now = new Date(2026, 3, 15, 14, 30); // Apr 15 2026
    expect(iso(getPeriodStart("monthly", BUDGET_START, now))).toBe(
      "2026-04-01 00:00:00",
    );
  });

  it('"yearly" returns Jan 1 of the current year', () => {
    const now = new Date(2026, 6, 4, 12, 0); // Jul 4 2026
    expect(iso(getPeriodStart("yearly", BUDGET_START, now))).toBe(
      "2026-01-01 00:00:00",
    );
  });

  it('"weekly" returns Monday of the current week', () => {
    // Wednesday April 15 2026
    const wednesday = new Date(2026, 3, 15, 14, 30);
    expect(iso(getPeriodStart("weekly", BUDGET_START, wednesday))).toBe(
      "2026-04-13 00:00:00",
    );
  });

  it('"weekly" handles Sunday correctly (rolls back to prior Monday)', () => {
    // Sunday April 19 2026
    const sunday = new Date(2026, 3, 19, 14, 30);
    expect(iso(getPeriodStart("weekly", BUDGET_START, sunday))).toBe(
      "2026-04-13 00:00:00",
    );
  });

  it('"weekly" returns same day on Monday', () => {
    // Monday April 13 2026
    const monday = new Date(2026, 3, 13, 8, 0);
    expect(iso(getPeriodStart("weekly", BUDGET_START, monday))).toBe(
      "2026-04-13 00:00:00",
    );
  });

  it("falls back to budgetStart for unknown periods", () => {
    const now = new Date(2026, 3, 15);
    expect(getPeriodStart("custom", BUDGET_START, now)).toBe(BUDGET_START);
  });
});

describe("getPeriodEnd", () => {
  it('"monthly" returns last day of the month at 23:59:59', () => {
    const start = new Date(2026, 3, 1); // April
    expect(iso(getPeriodEnd("monthly", start))).toBe("2026-04-30 23:59:59");
  });

  it('"monthly" handles February correctly (non-leap year)', () => {
    const start = new Date(2025, 1, 1); // Feb 2025
    expect(iso(getPeriodEnd("monthly", start))).toBe("2025-02-28 23:59:59");
  });

  it('"monthly" handles February in leap years', () => {
    const start = new Date(2024, 1, 1); // Feb 2024 — leap year
    expect(iso(getPeriodEnd("monthly", start))).toBe("2024-02-29 23:59:59");
  });

  it('"yearly" returns Dec 31 23:59:59', () => {
    const start = new Date(2026, 0, 1);
    expect(iso(getPeriodEnd("yearly", start))).toBe("2026-12-31 23:59:59");
  });

  it('"weekly" returns 6 days after start at 23:59:59', () => {
    const monday = new Date(2026, 3, 13);
    expect(iso(getPeriodEnd("weekly", monday))).toBe("2026-04-19 23:59:59");
  });

  it('"weekly" handles month rollover', () => {
    const monday = new Date(2026, 3, 27); // Apr 27
    expect(iso(getPeriodEnd("weekly", monday))).toBe("2026-05-03 23:59:59");
  });
});
