import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import {
  FLOW_CLASSES,
  FLOW_CLASS_GROUP,
  countedSql,
  incomeAmountSql,
  legacyFlagsFor,
  netSpendAmountSql,
  savedAmountSql,
  spendBucketSql,
} from "@/lib/analytics/flow";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";

const U = "u_flow";
const DAY = 86_400_000;
const today = new Date(Math.floor(Date.now() / DAY) * DAY);
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY);

beforeEach(async () => {
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: U, email: "flow@test.local" }));
  await db.insert(plaidItems).values(makePlaidItem({ id: "pi", userId: U, itemId: "it" }));
  await db.insert(financialAccounts).values([
    makeAccount({ id: "chk", userId: U, plaidItemId: "pi", type: "depository" }),
    makeAccount({ id: "card", userId: U, plaidItemId: "pi", type: "credit", subtype: "credit card" }),
  ]);
  const t = (id: string, accountId: string, amount: string, flowClass: string | null, over = {}) =>
    makeTxn({ id, userId: U, accountId, amount, flowClass, date: daysAgo(3), ...over });
  await db.insert(transactions).values([
    t("pay", "chk", "-2000.00", "income", { category: "INCOME" }),
    t("roommate", "chk", "-300.00", "reimbursement", { category: "OTHER" }),
    t("food", "card", "500.00", "spending", { category: "FOOD_AND_DRINK" }),
    t("food_refund", "card", "-50.00", "refund", { category: "FOOD_AND_DRINK" }),
    t("atm", "chk", "200.00", "cash_withdrawal", { category: "TRANSFER_OUT" }),
    t("invest", "chk", "400.00", "savings_out", { category: "TRANSFER_OUT" }),
    t("pay_card_out", "chk", "700.00", "cc_payment", { category: "LOAN_PAYMENTS" }),
    t("pay_card_in", "card", "-700.00", "cc_payment", { category: "LOAN_PAYMENTS" }),
    t("shoes", "card", "700.00", "spending", { category: "GENERAL_MERCHANDISE" }),
    t("fresh_pending", "card", "10.00", "spending", { category: "GENERAL_MERCHANDISE", pending: true }),
    t("stale_pending", "card", "99.00", "spending", {
      category: "GENERAL_MERCHANDISE",
      pending: true,
      date: daysAgo(30),
    }),
    t("unclassified", "chk", "1000.00", null, { category: "GENERAL_MERCHANDISE" }),
    t("relabelled", "card", "25.00", "spending", { category: "FOOD_AND_DRINK", customCategory: "GIFTS" }),
  ]);
});

describe("flow contract SQL", () => {
  it("computes income, net spending, saved and a closing net change", async () => {
    const db = getTestDb();
    const [row] = await db
      .select({
        income: sql<string>`sum(${incomeAmountSql})`,
        spend: sql<string>`sum(${netSpendAmountSql})`,
        saved: sql<string>`sum(${savedAmountSql})`,
        raw: sql<string>`sum(-(${transactions.amount})::numeric) filter (where ${transactions.flowClass} not in ('cc_payment','internal_transfer','zero'))`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, U), countedSql));

    expect(Number(row.income)).toBe(2000);
    // 500 food - 50 refund + 200 cash + 700 shoes + 10 fresh pending + 25 gifts - 300 reimbursement
    expect(Number(row.spend)).toBe(1085);
    expect(Number(row.saved)).toBe(400);
    const net = Number(row.income) - Number(row.spend) - Number(row.saved);
    expect(net).toBe(515);
    // Identity: net change equals the signed sum of every non-internal row.
    expect(Number(row.raw)).toBe(net);
  });

  it("groups by spend bucket (same expression in SELECT and GROUP BY)", async () => {
    const db = getTestDb();
    const rows = await db
      .select({ bucket: spendBucketSql, total: sql<string>`sum(${netSpendAmountSql})` })
      .from(transactions)
      .where(and(eq(transactions.userId, U), countedSql))
      .groupBy(spendBucketSql);
    const byBucket = Object.fromEntries(rows.map((r) => [r.bucket, Number(r.total)]));
    expect(byBucket.FOOD_AND_DRINK).toBe(450);
    expect(byBucket.GENERAL_MERCHANDISE).toBe(710);
    expect(byBucket.CASH_WITHDRAWALS).toBe(200);
    expect(byBucket.REIMBURSEMENTS).toBe(-300);
    expect(byBucket.GIFTS).toBe(25);
  });
});

describe("legacyFlagsFor", () => {
  it("derives the legacy flags from the group for every class", () => {
    for (const c of FLOW_CLASSES) {
      const g = FLOW_CLASS_GROUP[c];
      expect(legacyFlagsFor(c)).toEqual({
        isTransfer: g === "internal" || g === "savings",
        isRefund: g === "offset",
      });
    }
  });
});
