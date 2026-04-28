import { describe, it, expect } from "vitest";
import {
  calculateNetWorth,
  calculateBudgetPercentage,
} from "@/lib/utils/calculations";

const acct = (currentBalance: string | null) => ({ currentBalance });

describe("calculateNetWorth (in-memory account-list helper)", () => {
  it("returns 0 for empty input", () => {
    expect(calculateNetWorth([])).toBe(0);
  });

  it("sums positive balances", () => {
    expect(
      calculateNetWorth([acct("100.00"), acct("250.50"), acct("0.50")]),
    ).toBe(351);
  });

  it("supports negative balances (credit cards)", () => {
    expect(
      calculateNetWorth([acct("1000.00"), acct("-150.00")]),
    ).toBe(850);
  });

  it("treats null balance as 0", () => {
    expect(calculateNetWorth([acct(null), acct("42.00")])).toBe(42);
  });

  it("treats unparsable balance as 0 (defensive)", () => {
    expect(calculateNetWorth([acct("not-a-number"), acct("10.00")])).toBe(10);
  });
});

describe("calculateBudgetPercentage", () => {
  it("returns standard percent", () => {
    expect(calculateBudgetPercentage(40, 100)).toBe(40);
  });

  it("returns 0 when budgeted is 0 (avoid divide-by-zero)", () => {
    expect(calculateBudgetPercentage(50, 0)).toBe(0);
  });

  it("returns 0 when budgeted is negative (defensive)", () => {
    expect(calculateBudgetPercentage(50, -100)).toBe(0);
  });

  it("rounds to integer percent", () => {
    // 33.333... → 33
    expect(calculateBudgetPercentage(100, 300)).toBe(33);
  });

  it("can exceed 100% when overspent", () => {
    expect(calculateBudgetPercentage(150, 100)).toBe(150);
  });
});
