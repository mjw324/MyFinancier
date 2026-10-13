import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { getOverviewStats, getSpendingByCategory } from "@/lib/db/queries/overview";
import { getTransactionTotals } from "@/lib/db/queries/transactions";
import { aggregateIncomeAndExpenses, aggregateBySpendingType } from "@/lib/utils/aggregations";
import { makeUser, makePlaidItem, makeAccount, makeTxn } from "../setup/factories";

const USER = "u_consist";

/** A month containing a refund and a category override — the two things that
 *  made the dashboard and the transactions page disagree. */
const MONTH_START = new Date("2026-08-01T00:00:00Z");
const MONTH_END = new Date("2026-08-31T23:59:59Z");

beforeEach(async () => {
  // getOverviewStats reads the calendar month from the clock, so the clock has
  // to be inside the month being seeded. Fake Date only; real timers keep
  // PGlite's async working.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-20T12:00:00Z"));

  const db = getTestDb();
  await db.insert(user).values([makeUser({ id: USER, email: "c@test.local" })]);
  await db
    .insert(plaidItems)
    .values([makePlaidItem({ id: "pi", userId: USER, itemId: "item" })]);
  await db.insert(financialAccounts).values([
    makeAccount({
      id: "acct",
      userId: USER,
      plaidItemId: "pi",
      plaidAccountId: "pa",
      currentBalance: "1000.00",
    }),
  ]);
  await db.insert(transactions).values([
    makeTxn({
      id: "t_buy",
      userId: USER,
      accountId: "acct",
      plaidTransactionId: "p1",
      amount: "846.20",
      category: "GENERAL_MERCHANDISE",
      date: new Date("2026-08-05T00:00:00Z"),
    }),
    // The refund that used to read as income on one screen and reduced
    // spending on the other.
    makeTxn({
      id: "t_refund",
      userId: USER,
      accountId: "acct",
      plaidTransactionId: "p2",
      amount: "-846.20",
      category: "GENERAL_MERCHANDISE",
      date: new Date("2026-08-06T00:00:00Z"),
      isRefund: true,
      refundSource: "auto",
    }),
    makeTxn({
      id: "t_food",
      userId: USER,
      accountId: "acct",
      plaidTransactionId: "p3",
      amount: "55.30",
      category: "FOOD_AND_DRINK",
      date: new Date("2026-08-10T00:00:00Z"),
    }),
    makeTxn({
      id: "t_pay",
      userId: USER,
      accountId: "acct",
      plaidTransactionId: "p4",
      amount: "-2412.30",
      category: "INCOME",
      date: new Date("2026-08-07T00:00:00Z"),
    }),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

async function loadMonth() {
  const db = getTestDb();
  return db.query.transactions.findMany({
    where: (t, { and, eq, between }) =>
      and(eq(t.userId, USER), between(t.date, MONTH_START, MONTH_END)),
  });
}

describe("dashboard and transactions page agree", () => {
  it("reports the same expenses from both aggregation paths", async () => {
    const stats = await getOverviewStats(USER);
    const totals = await getTransactionTotals(USER, {
      startDate: MONTH_START,
      endDate: MONTH_END,
    });
    const dashboard = aggregateIncomeAndExpenses(await loadMonth());

    // 846.20 spent, 846.20 refunded, 55.30 food => 55.30.
    expect(stats.expensesThisMonth).toBeCloseTo(55.3, 2);
    expect(totals.expenses).toBeCloseTo(55.3, 2);
    expect(dashboard.expenses).toBeCloseTo(55.3, 2);
  });

  it("reports the same income from both aggregation paths", async () => {
    const stats = await getOverviewStats(USER);
    const totals = await getTransactionTotals(USER, {
      startDate: MONTH_START,
      endDate: MONTH_END,
    });
    const dashboard = aggregateIncomeAndExpenses(await loadMonth());

    // The refund must not appear as income anywhere.
    expect(stats.incomeThisMonth).toBeCloseTo(2412.30, 2);
    expect(totals.income).toBeCloseTo(2412.30, 2);
    expect(dashboard.income).toBeCloseTo(2412.30, 2);
  });

  it("keeps the refund out of the spending-type income figure too", async () => {
    const byType = aggregateBySpendingType(await loadMonth());
    expect(byType.income).toBeCloseTo(2412.30, 2);
    // The refund nets against the bucket it was spent from.
    expect(byType.totalExpenses).toBeCloseTo(55.3, 2);
  });
});

describe("effective category", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(transactions).values([
      makeTxn({
        id: "t_custom",
        userId: USER,
        accountId: "acct",
        plaidTransactionId: "p5",
        amount: "40.00",
        category: "FOOD_AND_DRINK",
        customCategory: "GROCERIES",
        date: new Date("2026-08-12T00:00:00Z"),
      }),
    ]);
  });

  it("groups the category chart by the user's override, not Plaid's value", async () => {
    // The chart used to group on the raw category while the click-through
    // filter used the override, so a slice opened a different set of rows.
    const byCategory = await getSpendingByCategory(USER, MONTH_START, MONTH_END);
    const names = byCategory.map((c) => c.category);
    expect(names).toContain("GROCERIES");
    expect(byCategory.find((c) => c.category === "GROCERIES")!.totalAmount).toBeCloseTo(40, 2);
    // The overridden row must not still be counted under its Plaid category.
    expect(byCategory.find((c) => c.category === "FOOD_AND_DRINK")!.totalAmount).toBeCloseTo(
      55.3,
      2,
    );
  });
});

describe("net worth precision", () => {
  it("sums balances without float drift", async () => {
    const db = getTestDb();
    await db.delete(transactions);
    await db.delete(financialAccounts);
    await db.insert(financialAccounts).values([
      makeAccount({
        id: "a1",
        userId: USER,
        plaidItemId: "pi",
        plaidAccountId: "pa1",
        currentBalance: "0.10",
      }),
      makeAccount({
        id: "a2",
        userId: USER,
        plaidItemId: "pi",
        plaidAccountId: "pa2",
        currentBalance: "0.20",
      }),
    ]);
    const stats = await getOverviewStats(USER);
    expect(stats.netWorth).toBe(0.3);
  });

  it("still nets liabilities against assets", async () => {
    const db = getTestDb();
    await db.delete(transactions);
    await db.delete(financialAccounts);
    await db.insert(financialAccounts).values([
      makeAccount({
        id: "a1",
        userId: USER,
        plaidItemId: "pi",
        plaidAccountId: "pa1",
        currentBalance: "1000.00",
        type: "depository",
      }),
      makeAccount({
        id: "a2",
        userId: USER,
        plaidItemId: "pi",
        plaidAccountId: "pa2",
        currentBalance: "75.25",
        type: "credit",
      }),
    ]);
    expect((await getOverviewStats(USER)).netWorth).toBe(924.75);
  });
});
