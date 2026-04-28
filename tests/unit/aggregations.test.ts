import { describe, it, expect } from "vitest";
import {
  aggregateIncomeAndExpenses,
  calculateSavingsRate,
} from "@/lib/utils/aggregations";

const t = (amount: string) => ({ amount });

describe("aggregateIncomeAndExpenses (Income + Expenses widgets)", () => {
  it("returns zeros for an empty array", () => {
    expect(aggregateIncomeAndExpenses([])).toEqual({ income: 0, expenses: 0 });
  });

  it("treats negative amounts as income (Plaid convention)", () => {
    const result = aggregateIncomeAndExpenses([
      t("-1000.00"),
      t("-500.00"),
      t("-0.50"),
    ]);
    expect(result).toEqual({ income: 1500.5, expenses: 0 });
  });

  it("treats positive amounts as expenses", () => {
    const result = aggregateIncomeAndExpenses([
      t("25.00"),
      t("75.00"),
      t("0.99"),
    ]);
    expect(result).toEqual({ income: 0, expenses: 100.99 });
  });

  it("splits mixed transactions correctly", () => {
    // Salary -3000, two expenses 50 + 25, refund -10
    const result = aggregateIncomeAndExpenses([
      t("-3000.00"),
      t("50.00"),
      t("25.00"),
      t("-10.00"),
    ]);
    expect(result).toEqual({ income: 3010, expenses: 75 });
  });

  it("ignores zero-amount transactions", () => {
    const result = aggregateIncomeAndExpenses([
      t("0"),
      t("0.00"),
      t("100.00"),
      t("-50.00"),
    ]);
    expect(result).toEqual({ income: 50, expenses: 100 });
  });

  it("rounds to 2 decimals to avoid floating-point drift", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754; rounded must be 0.3
    const result = aggregateIncomeAndExpenses([t("0.10"), t("0.20")]);
    expect(result.expenses).toBe(0.3);
  });

  it("handles a large dataset against a hand-calculated reference", () => {
    // 1000 expenses of $1.23 + 1000 incomes of -$2.50
    const txns = [
      ...Array.from({ length: 1000 }, () => t("1.23")),
      ...Array.from({ length: 1000 }, () => t("-2.50")),
    ];
    const result = aggregateIncomeAndExpenses(txns);
    expect(result).toEqual({ income: 2500, expenses: 1230 });
  });

  it("does not mutate the input array", () => {
    const txns = [t("100"), t("-50")];
    const snapshot = JSON.stringify(txns);
    aggregateIncomeAndExpenses(txns);
    expect(JSON.stringify(txns)).toBe(snapshot);
  });
});

describe("calculateSavingsRate (Savings Rate widget)", () => {
  it("returns standard percent: income 1000, expenses 400 → 60", () => {
    expect(calculateSavingsRate(1000, 400)).toBe(60);
  });

  it("returns 100 when no expenses", () => {
    expect(calculateSavingsRate(2000, 0)).toBe(100);
  });

  it("returns 0 when income exactly equals expenses (break even)", () => {
    expect(calculateSavingsRate(500, 500)).toBe(0);
  });

  it("returns negative percent when overspending", () => {
    // (1000 - 1500) / 1000 * 100 = -50
    expect(calculateSavingsRate(1000, 1500)).toBe(-50);
  });

  it("returns null when income is zero (avoid divide-by-zero)", () => {
    expect(calculateSavingsRate(0, 100)).toBeNull();
  });

  it("returns null when income is negative (defensive)", () => {
    expect(calculateSavingsRate(-100, 50)).toBeNull();
  });

  it("rounds to integer percent (matches dashboard display)", () => {
    // (1000 - 333.33) / 1000 * 100 = 66.667 → rounds to 67
    expect(calculateSavingsRate(1000, 333.33)).toBe(67);
  });
});
