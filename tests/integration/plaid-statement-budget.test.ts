// Round trips per sync / classification / recurring refresh. Production pays
// ~70 ms per statement (app us-east4, DB us-west-2), so these are budgets.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countStatements, getTestDb } from "../setup/pglite";
import { makePlaidItem, makeUser } from "../setup/factories";
import { plaidAccount, plaidTxn, pagedSync } from "../setup/plaid-fixtures";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { spendingRules } from "@/lib/db/schema/spending-rules";
import { transactions } from "@/lib/db/schema/transactions";

const plaid = vi.hoisted(() => ({
  transactionsSync: vi.fn(),
  transactionsRecurringGet: vi.fn(),
  accountsGet: vi.fn(),
}));
vi.mock("@/lib/plaid/client", () => ({ plaidClient: plaid }));
vi.mock("@/lib/utils/encryption", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

const N = 200;
const accounts = [plaidAccount("pa_chk"), plaidAccount("pa_card", { type: "credit" as never, subtype: "credit card" as never })];
const added = Array.from({ length: N }, (_, i) =>
  plaidTxn(`ptx_${i}`, i % 2 ? "pa_chk" : "pa_card", {
    amount: 5 + (i % 7),
    name: i % 3 ? "Coffee Shop" : "Grocery Store",
    merchant_name: i % 3 ? "Coffee Shop" : "Grocery Store",
    date: `2026-04-${String(1 + (i % 28)).padStart(2, "0")}`,
  }),
);

beforeEach(async () => {
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: "u1" }));
  await db.insert(plaidItems).values(makePlaidItem({ id: "i1", userId: "u1", itemId: "item1", accessToken: "tok" }));
  await db.insert(spendingRules).values({ userId: "u1", matchType: "merchant", matchValue: "coffee shop", spendingType: "discretionary" });
  plaid.transactionsSync.mockImplementation(
    pagedSync({ "": { added, accounts, next_cursor: "c1" }, c1: { next_cursor: "c1" } }),
  );
  plaid.accountsGet.mockResolvedValue({ data: { accounts } });
  plaid.transactionsRecurringGet.mockResolvedValue({
    data: {
      updated_datetime: "2026-04-30T00:00:00Z",
      inflow_streams: [],
      outflow_streams: Array.from({ length: 5 }, (_, s) => ({
        stream_id: `st_${s}`,
        account_id: "pa_card",
        description: `Stream ${s}`,
        merchant_name: `Stream ${s}`,
        frequency: "MONTHLY",
        status: "MATURE",
        is_active: true,
        first_date: "2026-01-01",
        last_date: "2026-04-01",
        predicted_next_date: "2026-05-01",
        average_amount: { amount: 10, iso_currency_code: "USD" },
        last_amount: { amount: 10, iso_currency_code: "USD" },
        personal_finance_category: null,
        transaction_ids: added.filter((_, i) => i % 2 === 0).slice(s * 20, s * 20 + 20).map((t) => t.transaction_id),
      })),
    },
  });
});

describe("statement budget (verify-plaid N2/N4, audit 8.1)", () => {
  it("sync, classify, recurring", async () => {
    const { syncTransactions } = await import("@/lib/plaid/sync");
    const { applySpendingClassifications } = await import("@/lib/spending/classify");
    const { fetchRecurringTransactions } = await import("@/lib/plaid/recurring");
    const s1 = await countStatements(() => syncTransactions("i1"));
    const s2 = await countStatements(() => syncTransactions("i1"));
    const ids = (await getTestDb().select({ id: transactions.id }).from(transactions)).map((r) => r.id);
    const c1 = await countStatements(() => applySpendingClassifications("u1", ids));
    const r1 = await countStatements(() => fetchRecurringTransactions("i1"));
    const r2 = await countStatements(() => fetchRecurringTransactions("i1"));
    console.log(
      `[count] N=${N} sync#1=${s1.statements} sync#2(no-op)=${s2.statements} classify(${ids.length})=${c1.statements} recurring#1=${r1.statements} recurring#2(unchanged)=${r2.statements}`,
    );
    expect(ids.length).toBe(N);
    // Before (cc54c04): sync of 200 new rows 679, no-op sync 3,
    // classify(200) 668, recurring refresh 451 every time (even unchanged).
    expect(s1.statements).toBeLessThanOrEqual(15);
    expect(s2.statements).toBeLessThanOrEqual(8);
    expect(c1.statements).toBe(1);
    expect(r1.statements).toBeLessThanOrEqual(12);
    expect(r2.statements).toBeLessThanOrEqual(10);
  });
});
