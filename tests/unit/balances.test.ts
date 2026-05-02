import { describe, it, expect } from "vitest";
import {
  projectedBalance,
  netWorthContribution,
  sumPendingAmount,
} from "@/lib/utils/balances";

describe("projectedBalance — depository", () => {
  it("equals current balance when no pending", () => {
    expect(projectedBalance("depository", "1000.00", 0)).toBe(1000);
  });

  it("subtracts pending charges (positive amounts)", () => {
    // $1000 with a pending $50 charge => $950 projected
    expect(projectedBalance("depository", 1000, 50)).toBe(950);
  });

  it("adds pending deposits (negative amounts)", () => {
    // $1000 with a pending $1000 paycheck (amount = -1000) => $2000
    expect(projectedBalance("depository", 1000, -1000)).toBe(2000);
  });

  it("handles mixed pending sums", () => {
    // pending: +50 charge, -200 deposit => sum = -150
    expect(projectedBalance("depository", 1000, -150)).toBe(1150);
  });

  it("treats null current balance as 0", () => {
    expect(projectedBalance("depository", null, 50)).toBe(-50);
  });
});

describe("projectedBalance — credit / loan", () => {
  it("equals current owed when no pending", () => {
    expect(projectedBalance("credit", "500.00", 0)).toBe(500);
  });

  it("increases owed for a pending charge", () => {
    // $500 owed + pending $75 charge => $575 projected owed
    expect(projectedBalance("credit", 500, 75)).toBe(575);
  });

  it("reduces owed for a pending refund (negative amount)", () => {
    expect(projectedBalance("credit", 500, -25)).toBe(475);
  });

  it("applies the same rule to loan accounts", () => {
    expect(projectedBalance("loan", 10000, 200)).toBe(10200);
  });
});

describe("netWorthContribution", () => {
  it("returns positive balance for depository", () => {
    expect(netWorthContribution("depository", 1000)).toBe(1000);
  });

  it("negates credit balances", () => {
    expect(netWorthContribution("credit", 500)).toBe(-500);
  });

  it("negates loan balances", () => {
    expect(netWorthContribution("loan", 10000)).toBe(-10000);
  });

  it("treats null as 0", () => {
    expect(netWorthContribution("depository", null)).toBe(0);
  });

  it("parses string balances", () => {
    expect(netWorthContribution("credit", "250.50")).toBe(-250.5);
  });
});

describe("sumPendingAmount", () => {
  it("returns 0 for empty input", () => {
    expect(sumPendingAmount([])).toBe(0);
  });

  it("sums amounts when pending flag is true or omitted", () => {
    expect(
      sumPendingAmount([
        { amount: "50.00", pending: true },
        { amount: "25.00", pending: true },
        { amount: "10.00" },
      ]),
    ).toBe(85);
  });

  it("skips rows explicitly marked pending=false", () => {
    expect(
      sumPendingAmount([
        { amount: "50.00", pending: true },
        { amount: "999.00", pending: false },
      ]),
    ).toBe(50);
  });

  it("handles negative amounts (incoming deposits)", () => {
    expect(
      sumPendingAmount([
        { amount: "-1000.00", pending: true },
        { amount: "50.00", pending: true },
      ]),
    ).toBe(-950);
  });
});
