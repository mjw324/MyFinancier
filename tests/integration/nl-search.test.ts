/**
 * Natural-language search: the mock model returns a filter spec; code
 * resolves it and the existing query runs it for the session user only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";
import { mockModel } from "../setup/mock-model";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { aiUsage } from "@/lib/db/schema/ai";
import { searchTransactions } from "@/lib/db/queries/transactions";
import { naturalLanguageSearch, specToParams, categoryChoices } from "@/lib/transactions/nl-search";

const U = "u_search";
const OTHER = "u_search_other";
const TODAY = new Date("2026-10-26T00:00:00Z");
const d = (s: string) => new Date(`${s}T00:00:00Z`);

beforeEach(async () => {
  vi.stubEnv("AI_ENABLED", "true");
  const db = getTestDb();
  await db.insert(user).values([makeUser({ id: U, email: "s@test.local" }), makeUser({ id: OTHER, email: "o@test.local" })]);
  await db.insert(plaidItems).values([makePlaidItem({ id: "pi_s", userId: U }), makePlaidItem({ id: "pi_o", userId: OTHER })]);
  await db.insert(financialAccounts).values([
    makeAccount({ id: "acct_s", userId: U, plaidItemId: "pi_s" }),
    makeAccount({ id: "acct_o", userId: OTHER, plaidItemId: "pi_o" }),
  ]);
  const t = (over: Parameters<typeof makeTxn>[0]) => makeTxn({ userId: U, accountId: "acct_s", ...over });
  await db.insert(transactions).values([
    t({ id: "amz_big_q3", name: "AMAZON.COM*2K4LM8", merchantName: "Amazon", amount: "72.10", date: d("2026-08-14"), category: "GENERAL_MERCHANDISE" }),
    t({ id: "amz_small_q3", name: "AMAZON.COM*9QQ1", merchantName: "Amazon", amount: "12.00", date: d("2026-09-02"), category: "GENERAL_MERCHANDISE" }),
    t({ id: "amz_big_q4", name: "AMAZON.COM*7XZ", merchantName: "Amazon", amount: "88.00", date: d("2026-10-03"), category: "GENERAL_MERCHANDISE" }),
    t({ id: "amz_refund_q3", name: "AMAZON.COM REFUND", merchantName: "Amazon", amount: "-60.00", date: d("2026-09-20"), category: "GENERAL_MERCHANDISE" }),
    t({ id: "coffee", name: "BLUE BOTTLE", merchantName: "Blue Bottle", amount: "6.50", date: d("2026-08-01"), category: "FOOD_AND_DRINK" }),
    makeTxn({ id: "other_amz", userId: OTHER, accountId: "acct_o", name: "AMAZON.COM", merchantName: "Amazon", amount: "500.00", date: d("2026-08-10") }),
  ]);
  await db.insert(userPreferences).values({ userId: U, aiOptIn: true, aiConsentAt: new Date(), aiConsentVersion: "v1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("specToParams", () => {
  it("resolves presets in code from the user's today", () => {
    const choices = categoryChoices(["FOOD_AND_DRINK"]);
    expect(specToParams({ text: "Amazon", minAmount: 50, period: { preset: "last_quarter" } }, TODAY, choices)).toEqual({
      search: "Amazon",
      min: "50",
      from: "2026-07-01",
      to: "2026-09-30",
    });
    // Categories map back to the stored value; unknown ones are dropped.
    expect(specToParams({ category: "FOOD AND DRINK" }, TODAY, choices)).toEqual({ category: "FOOD_AND_DRINK" });
    expect(specToParams({ category: "Everything" }, TODAY, choices)).toEqual({});
  });
});

describe("naturalLanguageSearch", () => {
  it("turns text into filters that the existing query runs for this user", async () => {
    const { model, prompts } = mockModel(() => ({ text: "Amazon", minAmount: 50, period: { preset: "last_quarter" } }));
    const res = await naturalLanguageSearch({ userId: U, text: "Amazon over $50 last quarter", today: TODAY, categories: ["GENERAL_MERCHANDISE"], model });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.href).toBe("/transactions?search=Amazon&from=2026-07-01&to=2026-09-30&min=50");

    // A refund over $50 matches too: amounts are magnitudes.
    const rows = await searchTransactions(U, res.query.filters);
    expect(rows.map((r) => r.id).sort()).toEqual(["amz_big_q3", "amz_refund_q3"]);

    expect(prompts[0]).toContain("Amazon over $50 last quarter");
    expect(prompts[0]).not.toContain(U);
    expect(prompts[0]).not.toContain("AMAZON.COM");
    expect(await getTestDb().select().from(aiUsage)).toHaveLength(1);
  });

  it("rejects specs outside the schema and reports empty", async () => {
    for (const answer of [{ sql: "SELECT * FROM transactions" }, { userId: OTHER }, { minAmount: -5 }, {}]) {
      const { model } = mockModel(() => answer);
      expect(await naturalLanguageSearch({ userId: U, text: "anything", today: TODAY, categories: [], model })).toEqual({ status: "empty" });
    }
  });

  it("is gated on AI_ENABLED and the opt-in", async () => {
    const { model, prompts } = mockModel(() => ({ text: "Amazon" }));
    vi.stubEnv("AI_ENABLED", "");
    expect(await naturalLanguageSearch({ userId: U, text: "Amazon", today: TODAY, categories: [], model })).toEqual({ status: "disabled" });
    expect(prompts).toHaveLength(0);
  });
});
