/**
 * Budget progress on the flow-class model (src/lib/analytics/flow.ts).
 * Synthetic data only. Ports verify-calcs 6.2, 6.3, N3 and N13.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { budgets } from "@/lib/db/schema/budgets";
import { transactions } from "@/lib/db/schema/transactions";
import { makeUser, makePlaidItem, makeAccount, makeTxn } from "../setup/factories";

const ctx = vi.hoisted(() => ({ userId: "user_a", tz: "UTC" }));
vi.mock("@/lib/auth/get-session", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: ctx.userId } })),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "tz" ? { name, value: ctx.tz } : undefined),
  }),
  headers: async () => new Headers(),
}));

import { getBudgetProgress } from "@/lib/db/queries/budgets";

const A = "user_a";
const B = "user_b";
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const TODAY = d("2026-08-20");

let seq = 0;
function txn(over: Parameters<typeof makeTxn>[0]) {
  seq++;
  return makeTxn({
    id: `t${seq}`,
    userId: A,
    accountId: "acct_a",
    plaidTransactionId: `pt${seq}`,
    date: d("2026-08-10"),
    flowClass: "spending",
    flowClassSource: "auto",
    ...over,
  });
}

async function budget(over: Partial<typeof budgets.$inferInsert> & { categoryKey: string }) {
  seq++;
  await getTestDb()
    .insert(budgets)
    .values({
      id: `b${seq}`,
      userId: A,
      amount: "300.00",
      period: "monthly",
      startDate: d("2026-01-01"),
      endDate: null,
      createdAt: new Date(`2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}Z`),
      ...over,
    });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-20T16:00:00Z"));
  ctx.tz = "UTC";
  const db = getTestDb();
  await db.insert(user).values([
    makeUser({ id: A, email: "a@test.local" }),
    makeUser({ id: B, email: "b@test.local" }),
  ]);
  await db.insert(plaidItems).values([
    makePlaidItem({ id: "pi_a", userId: A, itemId: "item_a" }),
    makePlaidItem({ id: "pi_b", userId: B, itemId: "item_b" }),
  ]);
  await db.insert(financialAccounts).values([
    makeAccount({ id: "acct_a", userId: A, plaidItemId: "pi_a", plaidAccountId: "pa_a" }),
    makeAccount({ id: "acct_b", userId: B, plaidItemId: "pi_b", plaidAccountId: "pa_b" }),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getBudgetProgress — matching (verify-calcs 6.2)", () => {
  it("returns [] without budgets", async () => {
    expect(await getBudgetProgress(A, TODAY)).toEqual([]);
  });

  it("a FOOD_AND_DRINK budget sees FOOD_AND_DRINK spending (Plaid's raw category value)", async () => {
    await budget({ categoryKey: "FOOD_AND_DRINK" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "75.00", name: "Burrito Place", category: "FOOD_AND_DRINK" }),
    ]);
    const [p] = await getBudgetProgress(A, TODAY);
    expect(p.spent).toBe(75);
    expect(p.categoryLabel).toBe("Food & drink");
    expect(p.categoryKey).toBe("FOOD_AND_DRINK");
  });

  it("a custom category wins over the Plaid category", async () => {
    await budget({ categoryKey: "Groceries" });
    await budget({ categoryKey: "FOOD_AND_DRINK" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "40.00", name: "Corner Grocer", category: "FOOD_AND_DRINK", customCategory: "Groceries" }),
      txn({ amount: "15.00", name: "Coffee Shop", category: "FOOD_AND_DRINK" }),
    ]);
    const [groceries, food] = await getBudgetProgress(A, TODAY);
    expect(groceries.spent).toBe(40);
    expect(groceries.categoryLabel).toBe("Groceries");
    expect(food.spent).toBe(15);
  });

  it("synthetic buckets: cash withdrawals and payments to people", async () => {
    await budget({ categoryKey: "CASH_WITHDRAWALS" });
    await budget({ categoryKey: "SENT_TO_PEOPLE" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "200.00", name: "ATM", category: "TRANSFER_OUT", flowClass: "cash_withdrawal" }),
      txn({ amount: "35.00", name: "Payment to Friend A", category: "TRANSFER_OUT", flowClass: "p2p_payment" }),
    ]);
    const [cash, people] = await getBudgetProgress(A, TODAY);
    expect(cash.spent).toBe(200);
    expect(cash.categoryLabel).toBe("Cash withdrawals");
    expect(people.spent).toBe(35);
  });
});

describe("getBudgetProgress — flow classes", () => {
  it("refunds and reimbursements offset spending in their bucket; transfers, income and unclassified rows never count", async () => {
    await budget({ categoryKey: "GENERAL_MERCHANDISE", amount: "200.00" });
    await budget({ categoryKey: "Rent", amount: "1000.00" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "120.00", name: "Store", category: "GENERAL_MERCHANDISE" }),
      txn({ amount: "-30.00", name: "Store refund", category: "GENERAL_MERCHANDISE", flowClass: "refund" }),
      // Internal / savings / income rows that happen to carry the category.
      txn({ amount: "500.00", name: "Card payment", category: "GENERAL_MERCHANDISE", flowClass: "cc_payment" }),
      txn({ amount: "250.00", name: "To brokerage", category: "GENERAL_MERCHANDISE", flowClass: "savings_out" }),
      txn({ amount: "-80.00", name: "Payroll", category: "GENERAL_MERCHANDISE", flowClass: "income" }),
      // Not classified yet (pre-backfill): excluded by countedSql.
      txn({ amount: "999.00", name: "Unclassified", category: "GENERAL_MERCHANDISE", flowClass: null, flowClassSource: null }),
      // Rent paid, roommate pays their share back (reimbursement categorised as Rent).
      txn({ amount: "1200.00", name: "Landlord", category: "RENT_AND_UTILITIES", customCategory: "Rent" }),
      txn({ amount: "-600.00", name: "Roommate A", category: "TRANSFER_IN", customCategory: "Rent", flowClass: "reimbursement" }),
      // A reimbursement without a custom category lands in REIMBURSEMENTS, not in a spending budget.
      txn({ amount: "-50.00", name: "Roommate B", category: "GENERAL_MERCHANDISE", flowClass: "reimbursement" }),
    ]);
    const [merch, rent] = await getBudgetProgress(A, TODAY);
    expect(merch.spent).toBe(90);
    expect(merch.offsets).toBe(30);
    expect(merch.remaining).toBe(110);
    expect(rent.spent).toBe(600);
    expect(rent.offsets).toBe(600);
    expect(rent.status).toBe("under");
  });

  it("refunds exceeding spending make `spent` negative, displayed as nothing used", async () => {
    await budget({ categoryKey: "GENERAL_MERCHANDISE", amount: "100.00" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "-60.00", name: "Return of last month's order", category: "GENERAL_MERCHANDISE", flowClass: "refund" }),
      txn({ amount: "20.00", name: "Store", category: "GENERAL_MERCHANDISE" }),
    ]);
    const [p] = await getBudgetProgress(A, TODAY);
    expect(p.spent).toBe(-40);
    expect(p.percentage).toBe(0);
    expect(p.remaining).toBe(100);
    expect(p.status).toBe("under");
  });

  it("verify-calcs N13: 100.40 of 100.00 is over budget", async () => {
    await budget({ categoryKey: "ENTERTAINMENT", amount: "100.00" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "60.20", name: "Cinema", category: "ENTERTAINMENT" }),
      txn({ amount: "40.20", name: "Concert", category: "ENTERTAINMENT" }),
    ]);
    const [p] = await getBudgetProgress(A, TODAY);
    expect(p.spent).toBe(100.4);
    expect(p.status).toBe("over");
    expect(p.remaining).toBe(-0.4);
  });

  it("is per user", async () => {
    await budget({ categoryKey: "FOOD_AND_DRINK" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "10.00", name: "Mine", category: "FOOD_AND_DRINK" }),
      txn({ userId: B, accountId: "acct_b", amount: "777.00", name: "Theirs", category: "FOOD_AND_DRINK" }),
    ]);
    const [p] = await getBudgetProgress(A, TODAY);
    expect(p.spent).toBe(10);
    expect(await getBudgetProgress(B, TODAY)).toEqual([]);
  });
});

describe("getBudgetProgress — periods (verify-calcs 6.3)", () => {
  it("half-open bounds on a mid-month anchor", async () => {
    await budget({ categoryKey: "TRAVEL", startDate: d("2026-06-15") });
    await getTestDb().insert(transactions).values([
      txn({ amount: "1.00", name: "before", category: "TRAVEL", date: d("2026-08-14") }),
      txn({ amount: "10.00", name: "first day", category: "TRAVEL", date: d("2026-08-15") }),
      txn({ amount: "20.00", name: "last day", category: "TRAVEL", date: d("2026-09-14") }),
      txn({ amount: "300.00", name: "next period", category: "TRAVEL", date: d("2026-09-15") }),
    ]);
    const [p] = await getBudgetProgress(A, TODAY);
    expect(p.window).toMatchObject({ start: "2026-08-15", end: "2026-09-14", state: "active" });
    expect(p.spent).toBe(30);
  });

  it("weekly and yearly budgets use their own windows; an ended budget shows its last period", async () => {
    // 2026-08-17 is a Monday.
    await budget({ categoryKey: "FOOD_AND_DRINK", period: "weekly", startDate: d("2026-08-03"), amount: "50.00" });
    await budget({ categoryKey: "TRAVEL", period: "yearly", startDate: d("2026-01-01"), amount: "2000.00" });
    await budget({ categoryKey: "ENTERTAINMENT", startDate: d("2026-01-01"), endDate: d("2026-07-10"), amount: "80.00" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "12.00", name: "this week", category: "FOOD_AND_DRINK", date: d("2026-08-17") }),
      txn({ amount: "99.00", name: "last week", category: "FOOD_AND_DRINK", date: d("2026-08-16") }),
      txn({ amount: "400.00", name: "flight", category: "TRAVEL", date: d("2026-02-02") }),
      txn({ amount: "25.00", name: "in July window", category: "ENTERTAINMENT", date: d("2026-07-10") }),
      txn({ amount: "70.00", name: "after end", category: "ENTERTAINMENT", date: d("2026-07-11") }),
    ]);
    const [weekly, yearly, ended] = await getBudgetProgress(A, TODAY);
    expect(weekly.window).toMatchObject({ start: "2026-08-17", end: "2026-08-23" });
    expect(weekly.spent).toBe(12);
    expect(yearly.spent).toBe(400);
    expect(ended.window).toMatchObject({ start: "2026-07-01", end: "2026-07-10", state: "ended" });
    expect(ended.spent).toBe(25);
  });

  it("verify-calcs N3: at 8:30pm New York on Aug 31 the August budget still includes Aug 31", async () => {
    vi.setSystemTime(new Date("2026-09-01T00:30:00Z"));
    ctx.tz = "America/New_York";
    await budget({ categoryKey: "FOOD_AND_DRINK" });
    await getTestDb().insert(transactions).values([
      txn({ amount: "60.00", name: "Dinner", category: "FOOD_AND_DRINK", date: d("2026-08-31") }),
    ]);
    // No explicit `today`: resolved from the viewer's time zone.
    const [p] = await getBudgetProgress(A);
    expect(p.window.start).toBe("2026-08-01");
    expect(p.spent).toBe(60);
  });
});
