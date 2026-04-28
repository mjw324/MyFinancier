import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import {
  searchTransactions,
  getTransactionCount,
} from "@/lib/db/queries/transactions";
import {
  makeUser,
  makePlaidItem,
  makeAccount,
  makeTxn,
} from "../setup/factories";

const USER_A = "user_a";
const USER_B = "user_b";

beforeEach(async () => {
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
      id: "acct_checking",
      userId: USER_A,
      plaidItemId: "pi_a",
      plaidAccountId: "pa_checking",
      name: "Checking",
    }),
    makeAccount({
      id: "acct_credit",
      userId: USER_A,
      plaidItemId: "pi_a",
      plaidAccountId: "pa_credit",
      name: "Credit",
    }),
    makeAccount({
      id: "acct_b",
      userId: USER_B,
      plaidItemId: "pi_b",
      plaidAccountId: "pa_b",
      name: "User B Account",
    }),
  ]);
  await db.insert(transactions).values([
    makeTxn({
      id: "t_starbucks",
      userId: USER_A,
      accountId: "acct_checking",
      plaidTransactionId: "pt_starbucks",
      amount: "5.50",
      name: "Starbucks Coffee",
      merchantName: "Starbucks",
      category: "FOOD_AND_DRINK",
      date: new Date(2026, 3, 5),
    }),
    makeTxn({
      id: "t_uber",
      userId: USER_A,
      accountId: "acct_credit",
      plaidTransactionId: "pt_uber",
      amount: "22.10",
      name: "UBER TRIP 4-15",
      merchantName: "Uber",
      category: "TRANSPORTATION",
      date: new Date(2026, 3, 15),
    }),
    makeTxn({
      id: "t_amazon",
      userId: USER_A,
      accountId: "acct_credit",
      plaidTransactionId: "pt_amazon",
      amount: "120.00",
      name: "AMZN Mktp US",
      merchantName: "Amazon",
      category: "GENERAL_MERCHANDISE",
      date: new Date(2026, 3, 20),
    }),
    makeTxn({
      id: "t_b_starbucks",
      userId: USER_B,
      accountId: "acct_b",
      plaidTransactionId: "pt_b_starbucks",
      amount: "9.99",
      name: "Starbucks Reserve",
      merchantName: "Starbucks",
      category: "FOOD_AND_DRINK",
      date: new Date(2026, 3, 5),
    }),
  ]);
});

describe("searchTransactions (Transactions search/filter)", () => {
  it("returns all of a user's transactions when no filters are passed", async () => {
    const rows = await searchTransactions(USER_A, {});
    expect(rows).toHaveLength(3);
  });

  it("never returns another user's transactions", async () => {
    const rows = await searchTransactions(USER_A, { search: "Starbucks" });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("t_starbucks");
  });

  it("filters by category exact match", async () => {
    const rows = await searchTransactions(USER_A, {
      category: "TRANSPORTATION",
    });
    expect(rows.map((r) => r.id)).toEqual(["t_uber"]);
  });

  it("filters by accountId", async () => {
    const rows = await searchTransactions(USER_A, { accountId: "acct_credit" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.accountId === "acct_credit")).toBe(true);
  });

  it("filters by date range (inclusive on both ends)", async () => {
    const rows = await searchTransactions(USER_A, {
      startDate: new Date(2026, 3, 5),
      endDate: new Date(2026, 3, 15),
    });
    expect(rows.map((r) => r.id).sort()).toEqual(["t_starbucks", "t_uber"]);
  });

  it("does case-insensitive ILIKE search on transaction name", async () => {
    const rows = await searchTransactions(USER_A, { search: "uber" });
    expect(rows.map((r) => r.id)).toEqual(["t_uber"]);
  });

  it("ILIKE search also matches merchant name", async () => {
    const rows = await searchTransactions(USER_A, { search: "amazon" });
    expect(rows.map((r) => r.id)).toEqual(["t_amazon"]);
  });

  it("ILIKE search supports partial substring match", async () => {
    const rows = await searchTransactions(USER_A, { search: "AMZN" });
    expect(rows.map((r) => r.id)).toEqual(["t_amazon"]);
  });

  it("AND-combines multiple filters", async () => {
    const rows = await searchTransactions(USER_A, {
      accountId: "acct_credit",
      startDate: new Date(2026, 3, 16),
      endDate: new Date(2026, 3, 25),
    });
    expect(rows.map((r) => r.id)).toEqual(["t_amazon"]);
  });

  it("returns empty when no transactions match", async () => {
    const rows = await searchTransactions(USER_A, { search: "nonexistent" });
    expect(rows).toEqual([]);
  });
});

describe("getTransactionCount", () => {
  it("counts all of a user's transactions when no filters", async () => {
    expect(await getTransactionCount(USER_A)).toBe(3);
    expect(await getTransactionCount(USER_B)).toBe(1);
  });

  it("counts respect filters and stay user-scoped", async () => {
    expect(
      await getTransactionCount(USER_A, { category: "FOOD_AND_DRINK" }),
    ).toBe(1);
    expect(
      await getTransactionCount(USER_B, { category: "FOOD_AND_DRINK" }),
    ).toBe(1);
  });
});
