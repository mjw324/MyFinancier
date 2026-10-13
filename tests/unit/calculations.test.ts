import { describe, it, expect } from "vitest";
import {
  budgetStatus,
  calculateBudgetPercentage,
  formatBudgetPercentage,
} from "@/lib/utils/calculations";

describe("calculateBudgetPercentage", () => {
  it("returns spent / budgeted as a percentage", () => {
    expect(calculateBudgetPercentage(40, 100)).toBe(40);
    expect(calculateBudgetPercentage(150, 100)).toBe(150);
  });

  it("returns 0 when budgeted is zero or negative", () => {
    expect(calculateBudgetPercentage(50, 0)).toBe(0);
    expect(calculateBudgetPercentage(50, -100)).toBe(0);
  });

  it("verify-calcs N13: 100.40 of 100 is over 100% (no rounding to 100)", () => {
    expect(calculateBudgetPercentage(100.4, 100) > 100).toBe(true);
  });
});

describe("budgetStatus (verify-calcs N13)", () => {
  it("is decided on exact cents", () => {
    expect(budgetStatus(100.4, 100)).toBe("over");
    expect(budgetStatus(100, 100)).toBe("near");
    expect(budgetStatus(100.001, 100)).toBe("near");
    expect(budgetStatus(84.99, 100)).toBe("under");
    expect(budgetStatus(85, 100)).toBe("near");
  });

  it("a net refund (negative spend) is under budget", () => {
    expect(budgetStatus(-20, 100)).toBe("under");
  });
});

describe("formatBudgetPercentage", () => {
  it("never shows 100% when under or over", () => {
    expect(formatBudgetPercentage(99.6, 100)).toBe("99%");
    expect(formatBudgetPercentage(100.4, 100)).toBe("101%");
    expect(formatBudgetPercentage(100, 100)).toBe("100%");
    expect(formatBudgetPercentage(-20, 100)).toBe("0%");
  });
});
