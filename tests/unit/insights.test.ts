import { describe, expect, it } from "vitest";
import {
  buildInsights,
  cashFlowInsight,
  formatPointsDelta,
  formatSignedRatio,
  type InsightInputs,
} from "@/lib/analytics/insights";
import type { CashFlow } from "@/lib/analytics/metrics";

function flow(over: Partial<CashFlow> = {}): CashFlow {
  return {
    income: 4000,
    otherIncome: 0,
    moneyIn: 4000,
    grossSpending: 3000,
    refunds: 0,
    reimbursements: 0,
    rewards: 0,
    offsets: 0,
    netSpending: 3000,
    savedOut: 0,
    savedIn: 0,
    savedNet: 0,
    netChange: 1000,
    byClass: {},
    rowCount: 10,
    unclassifiedCount: 0,
    stalePendingCount: 0,
    ...over,
  };
}

const base = (over: Partial<InsightInputs> = {}): InsightInputs => ({
  when: "in August 2026",
  periodLabel: "August 2026",
  isPartial: false,
  range: { from: "2026-08-01", to: "2026-08-31" },
  flow: flow(),
  ...over,
});

describe("display rounding", () => {
  it("shows a rate change in points, rounded once", () => {
    // Rounding each rate first (50% vs 50%) used to hide this change entirely.
    expect(formatPointsDelta(0.4951, 0.5049)).toBe("+1.0 pts");
    expect(formatPointsDelta(0.5, 0.35)).toBe("−15 pts");
    expect(formatPointsDelta(0.5, 0.5)).toBe("0 pts");
    expect(formatSignedRatio(-0.044)).toBe("−4%");
  });
});

describe("cash-flow sentence", () => {
  it("calls only net money moved to savings 'saved', as a share of money in", () => {
    const i = cashFlowInsight(base({ flow: flow({ savedNet: 1000, netChange: 0 }) }))!;
    expect(i.text).toBe(
      "You moved $1,000 to savings and investments in August 2026, 25% of the money that came in.",
    );
    expect(i.href).toBe("/transactions?from=2026-08-01&to=2026-08-31&flowGroup=savings");
  });

  it("never calls a positive net change 'saved'", () => {
    const i = cashFlowInsight(base())!;
    expect(i.text).toBe("Money in exceeded money out by $1,000 in August 2026, after savings.");
    expect(i.text).not.toMatch(/saved/i);
  });

  it("warns when more went out than came in", () => {
    const i = cashFlowInsight(base({ flow: flow({ netChange: -250.5 }) }))!;
    expect(i.tone).toBe("warning");
    expect(i.text).toBe("Money out exceeded money in by $251 in August 2026, counting savings.");
    const small = cashFlowInsight(base({ flow: flow({ netChange: -42.5 }) }))!;
    expect(small.text).toContain("by $42.50");
  });
});

describe("buildInsights", () => {
  it("links every finding to the rows it describes and de-duplicates by subject", () => {
    const list = buildInsights(
      base({
        flow: flow({ byClass: { cash_withdrawal: { total: 200, count: 2 } } }),
        anomalies: [
          { bucket: "TRAVEL", current: 288, typical: 23, excess: 265, ratio: null, severity: "high" },
        ],
        drifts: [
          { bucket: "TRAVEL", recent: 200, prior: 20, absolute: 180, ratio: null, direction: "up" },
          { bucket: "FOOD_AND_DRINK", recent: 700, prior: 600, absolute: 100, ratio: 0.1667, direction: "up" },
        ],
        driftRange: { from: "2026-02-01", to: "2026-07-31" },
        income: {
          primary: {
            key: "acme",
            label: "Acme Payroll",
            total: 1,
            count: 6,
            medianAmount: 1,
            firstSeen: "",
            lastSeen: "",
          },
          cadence: { medianGapDays: 14, frequency: "biweekly", medianAmount: 1, expectedPerMonth: 26 / 12 },
          depositsInPeriod: 3,
          expectedInPeriod: 2,
        },
      }),
    );
    const ids = list.map((i) => i.id);
    expect(ids).toContain("anomaly-TRAVEL");
    expect(ids).not.toContain("drift-TRAVEL");
    expect(list.length).toBeLessThanOrEqual(5);
    for (const i of list) expect(i.href).toMatch(/^\/transactions\?/);
    expect(list.find((i) => i.id === "anomaly-TRAVEL")!.href).toBe(
      "/transactions?from=2026-08-01&to=2026-08-31&bucket=TRAVEL",
    );
    expect(list.find((i) => i.id === "income-extra")!.text).toContain(
      "3 paychecks from Acme Payroll instead of the usual 2",
    );
  });
});
