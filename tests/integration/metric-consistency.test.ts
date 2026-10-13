import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { getCashFlow, getSpendingByBucket, periodScope } from "@/lib/analytics/metrics";
import { resolveDashboardPeriod, periodToRange } from "@/lib/utils/date-ranges";
import {
  getTransactionCount,
  getTransactionTotals,
  searchTransactions,
  type TransactionFilters,
} from "@/lib/db/queries/transactions";
import { parseTransactionQuery } from "@/lib/transactions/query";
import { buildTransactionsWorkbook } from "@/lib/transactions/export";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";

const USER = "u_consist";
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
// "Last month" as the dashboard resolves it when the viewer's today is 2026-09-10.
const PERIOD = resolveDashboardPeriod("last-month", day("2026-09-10"));

beforeEach(async () => {
  const db = getTestDb();
  await db.insert(user).values([makeUser({ id: USER, email: "c@test.local" })]);
  await db.insert(plaidItems).values([makePlaidItem({ id: "pi", userId: USER, itemId: "item" })]);
  await db.insert(financialAccounts).values([
    makeAccount({ id: "acct", userId: USER, plaidItemId: "pi" }),
    makeAccount({ id: "card", userId: USER, plaidItemId: "pi", type: "credit" }),
  ]);
  const t = (id: string, amount: string, flowClass: string | null, date: string, over = {}) =>
    makeTxn({ id, userId: USER, accountId: "acct", amount, flowClass, date: day(date), ...over });
  await db.insert(transactions).values([
    t("buy", "846.20", "spending", "2026-08-05", { category: "GENERAL_MERCHANDISE" }),
    t("refund", "-846.20", "refund", "2026-08-06", { category: "GENERAL_MERCHANDISE", isRefund: true }),
    t("food", "55.30", "spending", "2026-08-10", { category: "FOOD_AND_DRINK" }),
    t("custom", "40.00", "spending", "2026-08-12", { category: "FOOD_AND_DRINK", customCategory: "GROCERIES" }),
    t("pay", "-2412.30", "income", "2026-08-07", { category: "INCOME" }),
    t("share", "-25.00", "reimbursement", "2026-08-08", { category: "TRANSFER_IN" }),
    t("save", "300.00", "savings_out", "2026-08-15", { category: "TRANSFER_OUT", isTransfer: true }),
    t("cc_out", "120.00", "cc_payment", "2026-08-20", { category: "LOAN_PAYMENTS", isTransfer: true }),
    t("cc_in", "-120.00", "cc_payment", "2026-08-20", { accountId: "card", category: "LOAN_PAYMENTS", isTransfer: true }),
    t("unclassified", "10.00", null, "2026-08-21"),
    t("after", "99.00", "spending", "2026-09-01", { category: "FOOD_AND_DRINK" }),
  ]);
});

/** The filters the dashboard's links produce for its period. */
function linkFilters(includeTransfers: boolean): TransactionFilters {
  const q = parseTransactionQuery(periodToRange(PERIOD));
  return { ...q.filters, includeTransfers };
}

async function exportSummary(filters: TransactionFilters) {
  const [rows, totals] = await Promise.all([
    searchTransactions(USER, filters, { limit: 1_000_000 }),
    getTransactionTotals(USER, filters),
  ]);
  const buffer = await buildTransactionsWorkbook({
    mode: "standard",
    filterDisplay: {},
    rows,
    totals,
    generatedAt: new Date("2026-09-10T12:00:00Z"),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const summary = new Map<string, unknown>();
  wb.getWorksheet("Summary")!.eachRow((row) => {
    summary.set(String(row.getCell(1).value ?? ""), row.getCell(2).value);
  });
  const sheetRows = wb.getWorksheet("Transactions")!.rowCount - 1;
  return { summary, sheetRows, rows };
}

describe("dashboard and transactions page return identical totals", () => {
  it("cash flow == transactions totals == export summary for the same period", async () => {
    const dashboard = await getCashFlow(periodScope(USER, PERIOD));
    const filters = linkFilters(true);
    const totals = await getTransactionTotals(USER, filters);
    const { summary, sheetRows, rows } = await exportSummary(filters);

    // 846.20 − 846.20 + 55.30 + 40 − 25 reimbursement = 70.30
    expect(dashboard.netSpending).toBe(70.3);
    expect(dashboard.moneyIn).toBe(2412.3);
    expect(dashboard.savedNet).toBe(300);
    expect(dashboard.netChange).toBe(2042);

    for (const key of ["moneyIn", "netSpending", "savedNet", "netChange", "grossSpending", "offsets"] as const) {
      expect(totals[key], key).toBe(dashboard[key]);
    }
    expect(summary.get("Money in")).toBe(dashboard.moneyIn);
    expect(summary.get("Net spending")).toBe(dashboard.netSpending);
    expect(summary.get("Saved / moved (net)")).toBe(dashboard.savedNet);
    expect(summary.get("Net change (money in − net spending − saved/moved)")).toBe(dashboard.netChange);

    // Row counts agree: list count, totals count, export summary, export sheet.
    const count = await getTransactionCount(USER, filters);
    expect(totals.count).toBe(count);
    expect(rows.length).toBe(count);
    expect(summary.get("Total rows")).toBe(count);
    expect(sheetRows).toBe(count);
  });

  it("hiding transfers changes the row count consistently, not income or spending", async () => {
    const shown = await getTransactionTotals(USER, linkFilters(true));
    const hidden = linkFilters(false);
    const totals = await getTransactionTotals(USER, hidden);
    const count = await getTransactionCount(USER, hidden);
    expect(totals.count).toBe(count);
    expect(count).toBe(shown.count - 3); // savings_out and both card-payment legs
    expect(totals.moneyIn).toBe(shown.moneyIn);
    expect(totals.netSpending).toBe(shown.netSpending);
    const { summary, sheetRows } = await exportSummary(hidden);
    expect(summary.get("Total rows")).toBe(count);
    expect(sheetRows).toBe(count);
  });

  it("chart buckets agree with the totals and use the user's category override", async () => {
    const buckets = await getSpendingByBucket(periodScope(USER, PERIOD));
    const by = Object.fromEntries(
      [...buckets.buckets, ...buckets.negative].map((b) => [b.bucket, b.net]),
    );
    expect(by).toEqual({ FOOD_AND_DRINK: 55.3, GROCERIES: 40, REIMBURSEMENTS: -25 });
    // A fully refunded purchase nets to zero and is neither drawn nor reported.
    expect(by.GENERAL_MERCHANDISE).toBeUndefined();
    expect(buckets.netSpending).toBe(70.3);
  });
});
