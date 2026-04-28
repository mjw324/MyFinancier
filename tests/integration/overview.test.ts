import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { getOverviewStats } from "@/lib/db/queries/overview";
import {
  makeUser,
  makePlaidItem,
  makeAccount,
} from "../setup/factories";

const USER_A = "user_a";
const USER_B = "user_b";

async function seedUsers() {
  const db = getTestDb();
  await db.insert(user).values([
    makeUser({ id: USER_A, email: "a@test.local" }),
    makeUser({ id: USER_B, email: "b@test.local" }),
  ]);
  await db.insert(plaidItems).values([
    makePlaidItem({ id: "pi_a", userId: USER_A, itemId: "item_a" }),
    makePlaidItem({ id: "pi_b", userId: USER_B, itemId: "item_b" }),
  ]);
}

beforeEach(async () => {
  await seedUsers();
});

describe("getOverviewStats — Net Worth widget", () => {
  it("returns 0 net worth and 0 accounts when user has no accounts", async () => {
    const stats = await getOverviewStats(USER_A);
    expect(stats.netWorth).toBe(0);
    expect(stats.accountCount).toBe(0);
  });

  it("sums a single account's balance exactly", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values(
      makeAccount({
        id: "acct_1",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_1",
        currentBalance: "1234.56",
      }),
    );

    const stats = await getOverviewStats(USER_A);
    expect(stats.netWorth).toBe(1234.56);
    expect(stats.accountCount).toBe(1);
  });

  it("subtracts liability balances (credit cards, loans) from net worth", async () => {
    // Plaid stores credit/loan balances as POSITIVE numbers representing the
    // amount owed. Net worth must subtract them rather than add them.
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({
        id: "acct_1",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_1",
        currentBalance: "1000.00",
        type: "depository",
      }),
      makeAccount({
        id: "acct_2",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_2",
        currentBalance: "250.50",
        type: "depository",
      }),
      makeAccount({
        id: "acct_3",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_3",
        currentBalance: "75.25",
        type: "credit",
      }),
      makeAccount({
        id: "acct_4",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_4",
        currentBalance: "500.00",
        type: "loan",
      }),
    ]);

    const stats = await getOverviewStats(USER_A);
    // 1000.00 + 250.50 - 75.25 - 500.00 = 675.25
    expect(stats.netWorth).toBe(675.25);
    expect(stats.accountCount).toBe(4);
  });

  it("treats investment accounts as assets (added to net worth)", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({
        id: "acct_1",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_1",
        currentBalance: "10000.00",
        type: "investment",
      }),
      makeAccount({
        id: "acct_2",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_2",
        currentBalance: "2500.00",
        type: "credit",
      }),
    ]);

    const stats = await getOverviewStats(USER_A);
    expect(stats.netWorth).toBe(7500);
    expect(stats.accountCount).toBe(2);
  });

  it("isolates net worth by userId (no cross-user leakage)", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({
        id: "acct_a1",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_a1",
        currentBalance: "500.00",
      }),
      makeAccount({
        id: "acct_b1",
        userId: USER_B,
        plaidItemId: "pi_b",
        plaidAccountId: "pa_acct_b1",
        currentBalance: "9999.99",
      }),
      makeAccount({
        id: "acct_b2",
        userId: USER_B,
        plaidItemId: "pi_b",
        plaidAccountId: "pa_acct_b2",
        currentBalance: "1.00",
      }),
    ]);

    const statsA = await getOverviewStats(USER_A);
    const statsB = await getOverviewStats(USER_B);
    expect(statsA.netWorth).toBe(500);
    expect(statsA.accountCount).toBe(1);
    expect(statsB.netWorth).toBe(10000.99);
    expect(statsB.accountCount).toBe(2);
  });

  it("preserves numeric precision: 0.10 + 0.20 = 0.30 exactly", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({
        id: "acct_1",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_1",
        currentBalance: "0.10",
      }),
      makeAccount({
        id: "acct_2",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_2",
        currentBalance: "0.20",
      }),
    ]);

    const stats = await getOverviewStats(USER_A);
    // Postgres `numeric` is exact decimal; this would only fail if someone
    // accidentally cast through float8 in the query.
    expect(stats.netWorth).toBe(0.3);
  });

  it("treats null balances as 0 (coalesce), not NaN", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({
        id: "acct_1",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_1",
        currentBalance: null,
      }),
      makeAccount({
        id: "acct_2",
        userId: USER_A,
        plaidItemId: "pi_a",
        plaidAccountId: "pa_acct_2",
        currentBalance: "42.00",
      }),
    ]);

    const stats = await getOverviewStats(USER_A);
    expect(stats.netWorth).toBe(42);
    expect(stats.accountCount).toBe(2);
    expect(Number.isNaN(stats.netWorth)).toBe(false);
  });
});
