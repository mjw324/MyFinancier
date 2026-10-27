/**
 * "Explain this": slices compute every figure in code; the mock model only
 * writes placeholders, and any figure it types makes the template win.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../setup/pglite";
import { makeUser } from "../setup/factories";
import { mockModel } from "../setup/mock-model";
import { user } from "@/lib/db/schema/auth";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { aiUsage } from "@/lib/db/schema/ai";
import type { CashFlow } from "@/lib/analytics/metrics";
import { cashFlowSlice, dailySpendingSlice, whereItWentSlice, type ExplainSlice } from "@/lib/explain/slices";
import { explainSlice, EXPLAIN_RATE_LIMIT } from "@/lib/explain/narrate";

const U = "u_explain";

const flow = (over: Partial<CashFlow>): CashFlow => ({
  income: 0, otherIncome: 0, moneyIn: 0, grossSpending: 0, refunds: 0, reimbursements: 0, rewards: 0,
  offsets: 0, netSpending: 0, savedOut: 0, savedIn: 0, savedNet: 0, netChange: 0, byClass: {},
  rowCount: 0, unclassifiedCount: 0, stalePendingCount: 0, ...over,
});

const cashSlice = () =>
  cashFlowSlice({
    period: "October 2026",
    flow: flow({ moneyIn: 5200, netSpending: 3900.5, savedNet: 500, netChange: 799.5 }),
    previous: { label: "September 2026", flow: flow({ moneyIn: 5200, netSpending: 3000, savedNet: 500, netChange: 1700 }) },
  });

/** Every digit run in `text` must appear in some fact's display string. */
function digitsFromFacts(text: string, slice: ExplainSlice) {
  const displays = Object.values(slice.facts).map((f) => f.display).join(" | ");
  for (const run of text.match(/\d[\d,.]*/g) ?? []) expect(displays).toContain(run.replace(/[.,]$/, ""));
}

beforeEach(async () => {
  vi.stubEnv("AI_ENABLED", "true");
  await getTestDb().insert(user).values(makeUser({ id: U }));
  await getTestDb().insert(userPreferences).values({ userId: U, aiOptIn: true, aiConsentAt: new Date(), aiConsentVersion: "v1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("slices", () => {
  it("computes deltas, shares and averages in code", () => {
    const s = cashSlice();
    expect(s.facts.spendingChange.display).toBe("30%");
    expect(s.facts.spendingMoreOrLess.display).toBe("more");
    expect(s.facts.moneyInMoreOrLess.display).toBe("the same");
    expect(s.facts.netDirection.display).toBe("more came in than went out");

    const w = whereItWentSlice({
      period: "October 2026",
      buckets: {
        buckets: [
          { bucket: "FOOD_AND_DRINK", net: 600, gross: 650, offsets: 50, count: 30, share: 0.6 },
          { bucket: "TRAVEL", net: 400, gross: 400, offsets: 0, count: 2, share: 0.4 },
        ],
        negative: [],
        netSpending: 1000,
        positiveTotal: 1000,
      },
    });
    expect(w.facts.category1.display).toBe("Food And Drink");
    expect(w.facts.category1Share.display).toBe("60%");
    expect(w.facts.topShare.display).toBe("100%");

    const d = dailySpendingSlice({
      period: "the last 30 days",
      days: [
        { date: "2026-10-01", net: 10 },
        { date: "2026-10-02", net: 0 },
        { date: "2026-10-03", net: 50 },
      ],
    });
    expect(d.facts.averagePerDay.display).toBe("$20.00");
    expect(d.facts.peakDate.display).toBe("Oct 3");
    expect(d.facts.peakShare.display).toBe("83%");
  });
});

describe("explainSlice", () => {
  it("fills every figure from the slice", async () => {
    const slice = cashSlice();
    const { model, prompts } = mockModel(() => ({
      text: "You spent {{spending}} in {{period}}, {{spendingChange}} {{spendingMoreOrLess}} than {{previousPeriod}}.",
    }));
    const res = await explainSlice({ userId: U, slice, model });
    expect(res).toEqual({
      status: "ok",
      text: "You spent $3,901 in October 2026, 30% more than September 2026.",
      fromTemplate: false,
    });
    digitsFromFacts((res as { text: string }).text, slice);
    expect(prompts[0]).not.toContain(U);
    expect(await getTestDb().select().from(aiUsage)).toHaveLength(1);
  });

  it.each([
    ["a typed figure", "You spent $4,000 this month."],
    ["arithmetic", "That is {{spending}}, roughly 75 percent of {{moneyIn}}."],
    ["an unknown placeholder", "Your balance is {{balance}}."],
    ["a link", "See https://evil.example for details."],
  ])("falls back to the template on %s", async (_, text) => {
    const slice = cashSlice();
    const { model } = mockModel(() => ({ text }));
    const res = await explainSlice({ userId: U, slice, model });
    expect(res).toMatchObject({ status: "ok", fromTemplate: true });
    digitsFromFacts((res as { text: string }).text, slice);
  });

  it("is gated on AI_ENABLED, opt-in and the rate limit", async () => {
    const slice = cashSlice();
    const { model, prompts } = mockModel(() => ({ text: "{{spending}}" }));
    vi.stubEnv("AI_ENABLED", "");
    expect(await explainSlice({ userId: U, slice, model })).toEqual({ status: "disabled" });
    vi.stubEnv("AI_ENABLED", "true");
    const now = new Date();
    for (let i = 0; i < EXPLAIN_RATE_LIMIT.limit; i++) await explainSlice({ userId: U, slice, model, now });
    expect((await explainSlice({ userId: U, slice, model, now })).status).toBe("rate_limited");
    expect(prompts).toHaveLength(EXPLAIN_RATE_LIMIT.limit);
  });
});
