import { describe, it, expect } from "vitest";
import {
  computeAccountBalance,
  toCents,
  type AccountBalanceInput,
} from "@/lib/utils/balances";

const NOW = new Date("2026-08-15T16:00:00Z");

function acct(over: Partial<AccountBalanceInput> = {}): AccountBalanceInput {
  return {
    id: "a1",
    name: "Checking",
    type: "depository",
    currentBalance: "1000.00",
    availableBalance: null,
    creditLimit: null,
    isoCurrencyCode: "USD",
    lastSyncedAt: new Date("2026-08-15T10:00:00Z"),
    closedAt: null,
    pendingCents: 0,
    ...over,
  };
}

const view = (over: Partial<AccountBalanceInput> = {}) =>
  computeAccountBalance(acct(over), { now: NOW });

describe("toCents", () => {
  it("parses numeric strings exactly", () => {
    expect(toCents("0.10")).toBe(10);
    expect(toCents("1234.5")).toBe(123450);
    expect(toCents("-0.20")).toBe(-20);
    expect(toCents("1.005")).toBe(101);
    expect(toCents("-1.005")).toBe(-101);
    expect(toCents("12")).toBe(1200);
    expect(toCents(null)).toBeNull();
    expect(toCents("abc")).toBeNull();
  });
});

describe("computeAccountBalance — depository", () => {
  it("projected = current − pending when no available balance", () => {
    expect(view({ pendingCents: 5000 }).projectedCents).toBe(95000);
    expect(view({ pendingCents: -15000 }).projectedCents).toBe(115000);
  });

  it("uses `available` when it is lower (holds the bank already applied)", () => {
    expect(view({ availableBalance: "900.00" }).projectedCents).toBe(90000);
  });

  it("does not let an overdraft line inflate the spendable balance", () => {
    expect(view({ availableBalance: "1500.00" }).projectedCents).toBe(100000);
  });

  it("verify-calcs 4.2: pending 0.10 + 0.20 is cent-exact", () => {
    const v = view({ currentBalance: "0.00", pendingCents: -10 + -20 });
    expect(v.projectedCents).toBe(30);
    expect(v.netWorthProjectedCents / 100).toBe(0.3);
  });
});

describe("computeAccountBalance — credit / loan (verify-calcs 4.3)", () => {
  it("never uses `available` (remaining credit line) as a card balance", () => {
    const v = view({
      type: "credit",
      currentBalance: "300.00",
      availableBalance: "4700.00",
      pendingCents: 2000,
    });
    expect(v.projectedCents).toBe(32000);
    expect(v.netWorthSettledCents).toBe(-30000);
    expect(v.netWorthProjectedCents).toBe(-32000);
  });

  it("reports the credit limit and utilisation; estimates the limit from available", () => {
    const withLimit = view({ type: "credit", currentBalance: "250.00", creditLimit: "1000" });
    expect(withLimit.creditLimitCents).toBe(100000);
    expect(withLimit.utilization).toBeCloseTo(0.25);
    expect(withLimit.creditLimitEstimated).toBe(false);

    const estimated = view({ type: "credit", currentBalance: "300.00", availableBalance: "4700.00" });
    expect(estimated.creditLimitCents).toBe(500000);
    expect(estimated.creditLimitEstimated).toBe(true);
  });

  it("loans subtract their balance and ignore pending", () => {
    const v = view({ type: "loan", currentBalance: "20000.00", pendingCents: 5000 });
    expect(v.projectedCents).toBe(2000000);
    expect(v.netWorthSettledCents).toBe(-2000000);
  });
});

describe("computeAccountBalance — states", () => {
  it("verify-calcs 4.1: investment without a balance is unavailable, not $0", () => {
    const v = view({ type: "investment", currentBalance: null, availableBalance: null, lastSyncedAt: null });
    expect(v.state).toBe("unavailable");
    expect(v.settledCents).toBeNull();
    expect(v.includedInTotals).toBe(false);
    expect(v.netWorthSettledCents).toBe(0);
  });

  it("closed accounts are excluded from totals", () => {
    const v = view({ closedAt: new Date("2026-08-01T00:00:00Z") });
    expect(v.state).toBe("closed");
    expect(v.netWorthSettledCents).toBe(0);
    expect(v.isStale).toBe(false);
  });

  it("verify-calcs N9: non-USD accounts are flagged and excluded, never added", () => {
    const v = view({ isoCurrencyCode: "EUR" });
    expect(v.state).toBe("foreign_currency");
    expect(v.netWorthSettledCents).toBe(0);
  });

  it("flags balances older than the stale threshold", () => {
    expect(view({ lastSyncedAt: new Date("2026-08-11T10:00:00Z") }).isStale).toBe(true);
    expect(view({ lastSyncedAt: new Date("2026-08-14T10:00:00Z") }).isStale).toBe(false);
    expect(view({ lastSyncedAt: null }).isStale).toBe(true);
  });
});
