/**
 * Budget server actions: validation returns {success:false} instead of
 * throwing (verify-calcs 6.4 / N4), keys are scoped to the user (N5), and
 * update/delete are ownership-checked. Synthetic data only.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { categories } from "@/lib/db/schema/categories";
import { budgets } from "@/lib/db/schema/budgets";
import { transactions } from "@/lib/db/schema/transactions";
import { makeUser, makePlaidItem, makeAccount, makeTxn } from "../setup/factories";

const session = vi.hoisted(() => ({ userId: "user_a" }));
vi.mock("@/lib/auth/get-session", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: session.userId } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createBudgetAction,
  deleteBudgetAction,
  updateBudgetAction,
} from "@/app/(routes)/(dashboard)/budgets/actions";

const A = "user_a";
const B = "user_b";
// `categoryId` is the legacy field (ignored now). It is passed so that, on the
// old code, validation reaches the amount/date checks these tests target.
const valid = {
  categoryId: "cat_own",
  categoryKey: "FOOD_AND_DRINK",
  amount: "250",
  period: "monthly" as const,
  startDate: "2026-08-01",
};

beforeEach(async () => {
  session.userId = A;
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
  await db.insert(categories).values({ id: "cat_own", userId: A, name: "Food" });
  await db.insert(transactions).values([
    makeTxn({ id: "ta", userId: A, accountId: "acct_a", plaidTransactionId: "pta", customCategory: "Groceries" }),
    makeTxn({ id: "tb", userId: B, accountId: "acct_b", plaidTransactionId: "ptb", customCategory: "Other user's label" }),
  ]);
});

const rows = () => getTestDb().select().from(budgets);

describe("createBudgetAction — validation (verify-calcs 6.4)", () => {
  it.each([
    ["12abc"],
    ["Infinity"],
    ["1e400"],
    ["-5"],
    ["0"],
    [""],
    ["100000001"],
  ])("amount %j → {success:false}, nothing stored", async (amount) => {
    const res = await createBudgetAction({ ...valid, amount });
    expect(res).toMatchObject({ success: false });
    expect(await rows()).toHaveLength(0);
  });

  it.each([["garbage"], ["2026-02-31"], ["08/01/2026"], [""]])(
    "start date %j → {success:false}",
    async (startDate) => {
      await expect(createBudgetAction({ ...valid, startDate })).resolves.toMatchObject({
        success: false,
      });
    },
  );

  it("rejects an end date before the start date and unknown periods", async () => {
    expect(await createBudgetAction({ ...valid, endDate: "2026-07-31" })).toMatchObject({ success: false });
    expect(
      await createBudgetAction({ ...valid, period: "daily" as unknown as "monthly" }),
    ).toMatchObject({ success: false });
  });

  it("stores a valid budget with its key, a 2-decimal amount and UTC dates", async () => {
    const res = await createBudgetAction({ ...valid, amount: "250.456", endDate: "2026-12-31" });
    expect(res.success).toBe(true);
    const [row] = await rows();
    expect(row).toMatchObject({
      userId: A,
      categoryKey: "FOOD_AND_DRINK",
      amount: "250.46",
      period: "monthly",
      categoryId: null,
    });
    expect(row.startDate.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(row.endDate?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("accepts the user's own custom category", async () => {
    expect(await createBudgetAction({ ...valid, categoryKey: "Groceries" })).toMatchObject({ success: true });
  });

  it("rejects an overlapping budget on the same category and period", async () => {
    expect((await createBudgetAction(valid)).success).toBe(true);
    expect(await createBudgetAction({ ...valid, startDate: "2026-09-01" })).toMatchObject({ success: false });
    // A different period on the same category is fine.
    expect((await createBudgetAction({ ...valid, period: "weekly" })).success).toBe(true);
  });
});

describe("budget ownership (verify-calcs N5)", () => {
  it("a budget on another user's category is rejected and reveals nothing", async () => {
    await getTestDb().insert(categories).values({ id: "cat_secret", userId: B, name: "Other user's label" });
    // Both the legacy id and the other user's custom label are refused.
    const input = { ...valid, categoryId: "cat_secret", categoryKey: "Other user's label" };
    const res = await createBudgetAction(input);
    expect(res.success).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  it("update and delete only touch the caller's budgets", async () => {
    session.userId = B;
    expect((await createBudgetAction(valid)).success).toBe(true);
    const [theirs] = await rows();

    session.userId = A;
    expect(await updateBudgetAction({ ...valid, amount: "1", budgetId: theirs.id })).toEqual({
      success: false,
      error: "Budget not found",
    });
    expect(await deleteBudgetAction(theirs.id)).toEqual({ success: false, error: "Budget not found" });
    expect(await deleteBudgetAction("")).toMatchObject({ success: false });

    const [after] = await getTestDb().select().from(budgets).where(eq(budgets.id, theirs.id));
    expect(after.amount).toBe("250.00");
  });

  it("the owner can update and delete", async () => {
    await createBudgetAction(valid);
    const [mine] = await rows();
    expect(
      await updateBudgetAction({ ...valid, amount: "300", period: "yearly", budgetId: mine.id }),
    ).toMatchObject({ success: true });
    const [updated] = await rows();
    expect(updated).toMatchObject({ amount: "300.00", period: "yearly" });
    expect(await deleteBudgetAction(mine.id)).toMatchObject({ success: true });
    expect(await rows()).toHaveLength(0);
  });
});
