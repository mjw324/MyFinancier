import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { categories } from "@/lib/db/schema/categories";
import { budgets } from "@/lib/db/schema/budgets";
import { transactions } from "@/lib/db/schema/transactions";
import { getBudgetProgress } from "@/lib/db/queries/overview";
import {
  makeUser,
  makePlaidItem,
  makeAccount,
  makeTxn,
} from "../setup/factories";

const USER_A = "user_a";
const USER_B = "user_b";

// Wednesday Apr 15 2026 — comfortably mid-month for "monthly" budgets.
const NOW = new Date(2026, 3, 15, 12, 0, 0);

beforeEach(async () => {
  // Only fake `Date` — timers stay real so PGlite/Drizzle async still works.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  const db = getTestDb();
  await db.insert(user).values([
    makeUser({ id: USER_A, email: "a@test.local" }),
    makeUser({ id: USER_B, email: "b@test.local" }),
  ]);
  await db.insert(plaidItems).values([
    makePlaidItem({ id: "pi_a", userId: USER_A, itemId: "item_a" }),
    makePlaidItem({ id: "pi_b", userId: USER_B, itemId: "item_b" }),
  ]);
  await db.insert(financialAccounts).values([
    makeAccount({
      id: "acct_a",
      userId: USER_A,
      plaidItemId: "pi_a",
      plaidAccountId: "pa_acct_a",
    }),
    makeAccount({
      id: "acct_b",
      userId: USER_B,
      plaidItemId: "pi_b",
      plaidAccountId: "pa_acct_b",
    }),
  ]);
  await db.insert(categories).values([
    {
      id: "cat_food",
      userId: USER_A,
      name: "Food And Drink",
      icon: null,
      color: null,
      isDefault: false,
      createdAt: NOW,
    },
    {
      id: "cat_travel",
      userId: USER_A,
      name: "Travel",
      icon: null,
      color: null,
      isDefault: false,
      createdAt: NOW,
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getBudgetProgress (Budgets feature)", () => {
  it("returns an empty array when the user has no budgets", async () => {
    const result = await getBudgetProgress(USER_A);
    expect(result).toEqual([]);
  });

  it("sums in-period expenses against the budgeted amount", async () => {
    const db = getTestDb();
    await db.insert(budgets).values({
      id: "b_food",
      userId: USER_A,
      categoryId: "cat_food",
      amount: "500.00",
      period: "monthly",
      startDate: new Date(2026, 0, 1),
      endDate: null,
      createdAt: NOW,
    });
    await db.insert(transactions).values([
      makeTxn({
        id: "t1",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt1",
        amount: "120.00",
        category: "Food And Drink",
        date: new Date(2026, 3, 5), // in April
      }),
      makeTxn({
        id: "t2",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt2",
        amount: "30.50",
        category: "Food And Drink",
        date: new Date(2026, 3, 14), // in April
      }),
    ]);

    const [progress] = await getBudgetProgress(USER_A);
    expect(progress.budgeted).toBe(500);
    expect(progress.spent).toBe(150.5);
    expect(progress.categoryName).toBe("Food And Drink");
    expect(progress.period).toBe("monthly");
  });

  it("excludes transactions from outside the active period", async () => {
    const db = getTestDb();
    await db.insert(budgets).values({
      id: "b_food",
      userId: USER_A,
      categoryId: "cat_food",
      amount: "500.00",
      period: "monthly",
      startDate: new Date(2026, 0, 1),
      endDate: null,
      createdAt: NOW,
    });
    await db.insert(transactions).values([
      // last month — excluded
      makeTxn({
        id: "t_prev",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt_prev",
        amount: "999.00",
        category: "Food And Drink",
        date: new Date(2026, 2, 31), // March
      }),
      // current month — included
      makeTxn({
        id: "t_cur",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt_cur",
        amount: "40.00",
        category: "Food And Drink",
        date: new Date(2026, 3, 10),
      }),
    ]);

    const [progress] = await getBudgetProgress(USER_A);
    expect(progress.spent).toBe(40);
  });

  it("excludes transactions from other categories", async () => {
    const db = getTestDb();
    await db.insert(budgets).values({
      id: "b_food",
      userId: USER_A,
      categoryId: "cat_food",
      amount: "500.00",
      period: "monthly",
      startDate: new Date(2026, 0, 1),
      endDate: null,
      createdAt: NOW,
    });
    await db.insert(transactions).values([
      makeTxn({
        id: "t1",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt1",
        amount: "60.00",
        category: "Food And Drink",
        date: new Date(2026, 3, 5),
      }),
      makeTxn({
        id: "t2",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt2",
        amount: "200.00",
        category: "Travel",
        date: new Date(2026, 3, 5),
      }),
    ]);

    const [progress] = await getBudgetProgress(USER_A);
    expect(progress.spent).toBe(60);
  });

  it("excludes income (negative amounts)", async () => {
    const db = getTestDb();
    await db.insert(budgets).values({
      id: "b_food",
      userId: USER_A,
      categoryId: "cat_food",
      amount: "500.00",
      period: "monthly",
      startDate: new Date(2026, 0, 1),
      endDate: null,
      createdAt: NOW,
    });
    await db.insert(transactions).values([
      makeTxn({
        id: "t1",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt1",
        amount: "75.00",
        category: "Food And Drink",
        date: new Date(2026, 3, 5),
      }),
      // refund — negative, must NOT be subtracted into "spent"
      makeTxn({
        id: "t2",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt2",
        amount: "-25.00",
        category: "Food And Drink",
        date: new Date(2026, 3, 6),
      }),
    ]);

    const [progress] = await getBudgetProgress(USER_A);
    expect(progress.spent).toBe(75);
  });

  it("isolates progress per user", async () => {
    const db = getTestDb();
    // User B has their own category + budget + spend; must not bleed into A.
    await db.insert(categories).values({
      id: "cat_food_b",
      userId: USER_B,
      name: "Food And Drink",
      icon: null,
      color: null,
      isDefault: false,
      createdAt: NOW,
    });
    await db.insert(budgets).values([
      {
        id: "b_a",
        userId: USER_A,
        categoryId: "cat_food",
        amount: "500.00",
        period: "monthly",
        startDate: new Date(2026, 0, 1),
        endDate: null,
        createdAt: NOW,
      },
      {
        id: "b_b",
        userId: USER_B,
        categoryId: "cat_food_b",
        amount: "999.00",
        period: "monthly",
        startDate: new Date(2026, 0, 1),
        endDate: null,
        createdAt: NOW,
      },
    ]);
    await db.insert(transactions).values([
      makeTxn({
        id: "t_a",
        userId: USER_A,
        accountId: "acct_a",
        plaidTransactionId: "pt_a",
        amount: "10.00",
        category: "Food And Drink",
        date: new Date(2026, 3, 5),
      }),
      makeTxn({
        id: "t_b",
        userId: USER_B,
        accountId: "acct_b",
        plaidTransactionId: "pt_b",
        amount: "777.00",
        category: "Food And Drink",
        date: new Date(2026, 3, 5),
      }),
    ]);

    const a = await getBudgetProgress(USER_A);
    expect(a).toHaveLength(1);
    expect(a[0].spent).toBe(10);

    const b = await getBudgetProgress(USER_B);
    expect(b).toHaveLength(1);
    expect(b[0].spent).toBe(777);
  });
});
