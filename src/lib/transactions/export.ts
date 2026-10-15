import ExcelJS from "exceljs";
import type {
  searchTransactions,
  TransactionTotals,
} from "@/lib/db/queries/transactions";
import { FLOW_CLASS_LABEL, isFlowClass } from "@/lib/analytics/flow";
import { bucketLabel } from "@/lib/analytics/labels";

export type ExportMode = "standard" | "detailed";

export type TransactionRow = Awaited<ReturnType<typeof searchTransactions>>[number];

/** Summary figures: the same metric the dashboard and totals bar use. */
export type Totals = Pick<
  TransactionTotals,
  | "count"
  | "income"
  | "otherIncome"
  | "moneyIn"
  | "grossSpending"
  | "refunds"
  | "reimbursements"
  | "rewards"
  | "netSpending"
  | "savedNet"
  | "netChange"
  | "unclassifiedCount"
  | "stalePendingCount"
>;

export type FilterDisplay = {
  search?: string;
  accountName?: string;
  category?: string;
  bucket?: string;
  flowClass?: string;
  flowGroup?: string;
  counterparty?: string;
  cost?: "fixed" | "variable";
  view?: "spending";
  startDate?: Date;
  endDate?: Date;
  recurring?: "all" | "recurring" | "onetime";
  spendingType?: "necessary" | "discretionary" | "unclassified";
  includeTransfers?: boolean;
};

export type BuildArgs = {
  mode: ExportMode;
  filterDisplay: FilterDisplay;
  rows: TransactionRow[];
  totals: Totals;
  generatedAt: Date;
};

const CURRENCY_FMT = '#,##0.00;-#,##0.00';

const STANDARD_COLUMNS = [
  { header: "Date", key: "date", width: 12 },
  { header: "Description", key: "description", width: 36 },
  { header: "Merchant", key: "merchant", width: 24 },
  // Bank sign convention, stated in the header so nobody has to guess.
  { header: "Amount (+ out / − in)", key: "amount", width: 20 },
  { header: "Category", key: "category", width: 22 },
  { header: "Flow", key: "flow", width: 26 },
  { header: "Account", key: "account", width: 22 },
  { header: "Spending Type", key: "spendingType", width: 16 },
];

const DETAIL_EXTRA_COLUMNS = [
  { header: "Transaction ID", key: "id", width: 38 },
  { header: "Plaid Transaction ID", key: "plaidId", width: 38 },
  { header: "Account ID", key: "accountId", width: 38 },
  { header: "Original Name", key: "originalName", width: 30 },
  { header: "Custom Name", key: "customName", width: 24 },
  { header: "Original Category", key: "originalCategory", width: 22 },
  { header: "Custom Category", key: "customCategory", width: 22 },
  { header: "Normalized Merchant", key: "normalizedMerchant", width: 24 },
  { header: "Name Signature", key: "nameSignature", width: 24 },
  { header: "Pending", key: "pending", width: 10 },
  { header: "Flow Class", key: "flowClass", width: 22 },
  { header: "Flow Class Source", key: "flowClassSource", width: 16 },
  { header: "Counterparty Key", key: "counterpartyKey", width: 24 },
  { header: "Is Transfer", key: "isTransfer", width: 12 },
  { header: "Is Refund", key: "isRefund", width: 10 },
  { header: "Transfer Pair ID", key: "transferPairId", width: 38 },
  { header: "Recurring Stream ID", key: "recurringStreamId", width: 38 },
  { header: "Spending Type Source", key: "spendingTypeSource", width: 18 },
  { header: "Account Type", key: "accountType", width: 14 },
  { header: "Account Subtype", key: "accountSubtype", width: 16 },
  { header: "Created At", key: "createdAt", width: 22 },
];

export async function buildTransactionsWorkbook(
  args: BuildArgs,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MyFinancier";
  wb.created = args.generatedAt;

  buildSummarySheet(wb, args);
  buildTransactionsSheet(wb, args);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function buildSummarySheet(wb: ExcelJS.Workbook, args: BuildArgs) {
  const sheet = wb.addWorksheet("Summary");
  sheet.columns = [{ width: 22 }, { width: 50 }];

  const title = sheet.addRow(["MyFinancier Transaction Export"]);
  title.font = { bold: true, size: 14 };
  sheet.mergeCells(`A${title.number}:B${title.number}`);

  sheet.addRow([]);
  sheet.addRow(["Generated at", args.generatedAt.toISOString()]);
  sheet.addRow([
    "Mode",
    args.mode === "detailed" ? "Detailed (debug)" : "Standard",
  ]);
  // The rows actually written below, so the summary and the sheet agree.
  sheet.addRow(["Total rows", args.rows.length]);
  const t = args.totals;
  const notCounted = t.unclassifiedCount + t.stalePendingCount;
  if (notCounted > 0) {
    sheet.addRow([
      "Not counted in totals",
      `${notCounted} (${t.unclassifiedCount} not classified yet, ${t.stalePendingCount} stale pending)`,
    ]);
  }

  sheet.addRow([]);
  const moneyHeader = sheet.addRow(["Totals (same figures as the dashboard)"]);
  moneyHeader.font = { bold: true };
  const money = (label: string, value: number, bold = false) => {
    const row = sheet.addRow([label, value]);
    row.getCell(2).numFmt = CURRENCY_FMT;
    if (bold) row.font = { bold: true };
  };
  money("Income", t.income);
  money("Other money in", t.otherIncome);
  money("Money in", t.moneyIn, true);
  money("Spending (before refunds)", t.grossSpending);
  money("Refunds", -t.refunds);
  money("Reimbursements", -t.reimbursements);
  money("Rewards", -t.rewards);
  money("Net spending", t.netSpending, true);
  money("Saved / moved (net)", t.savedNet);
  money("Net change (money in − net spending − saved/moved)", t.netChange, true);
  sheet.addRow([
    "Sign convention",
    "Summary: Net change > 0 means more came in than went out. Transactions sheet Amount: positive = money out, negative = money in.",
  ]);

  sheet.addRow([]);
  const filtersHeader = sheet.addRow(["Filters applied"]);
  filtersHeader.font = { bold: true };

  const entries = describeFilters(args.filterDisplay);
  if (entries.length === 0) {
    sheet.addRow(["", "(none — all transactions)"]);
  } else {
    for (const [k, v] of entries) sheet.addRow([k, v]);
  }
}

function buildTransactionsSheet(wb: ExcelJS.Workbook, args: BuildArgs) {
  const sheet = wb.addWorksheet("Transactions", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const cols =
    args.mode === "detailed"
      ? [...STANDARD_COLUMNS, ...DETAIL_EXTRA_COLUMNS]
      : STANDARD_COLUMNS;
  sheet.columns = cols.map((c) => ({ ...c }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };

  for (const row of args.rows) {
    const base = {
      date: row.date,
      description: row.customName ?? row.name,
      merchant: row.merchantName ?? "",
      amount: parseFloat(row.amount),
      category: row.customCategory ?? row.category ?? "",
      flow: flowLabel(row.flowClass),
      account: row.financialAccount?.name ?? "",
      spendingType: row.spendingType ?? "",
    };

    if (args.mode === "detailed") {
      sheet.addRow({
        ...base,
        id: row.id,
        plaidId: row.plaidTransactionId ?? "",
        accountId: row.accountId,
        originalName: row.name,
        customName: row.customName ?? "",
        originalCategory: row.category ?? "",
        customCategory: row.customCategory ?? "",
        normalizedMerchant: row.normalizedMerchant ?? "",
        nameSignature: row.nameSignature ?? "",
        pending: row.pending ? "yes" : "no",
        flowClass: row.flowClass ?? "",
        flowClassSource: row.flowClassSource ?? "",
        counterpartyKey: row.counterpartyKey ?? "",
        isTransfer: row.isTransfer ? "yes" : "no",
        isRefund: row.isRefund ? "yes" : "no",
        transferPairId: row.transferPairId ?? "",
        recurringStreamId: row.recurringStreamId ?? "",
        spendingTypeSource: row.spendingTypeSource ?? "",
        accountType: row.financialAccount?.type ?? "",
        accountSubtype: row.financialAccount?.subtype ?? "",
        createdAt: row.createdAt ?? "",
      });
    } else {
      sheet.addRow(base);
    }
  }

  sheet.getColumn("date").numFmt = "yyyy-mm-dd";
  sheet.getColumn("amount").numFmt = CURRENCY_FMT;
  if (args.mode === "detailed") {
    sheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm:ss";
  }
}

function describeFilters(fd: FilterDisplay): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (fd.search) out.push(["Search", fd.search]);
  if (fd.accountName) out.push(["Account", fd.accountName]);
  if (fd.category) out.push(["Category", fd.category]);
  if (fd.bucket) out.push(["Spending bucket", bucketLabel(fd.bucket)]);
  if (fd.flowClass) {
    out.push([
      "Flow",
      isFlowClass(fd.flowClass) ? FLOW_CLASS_LABEL[fd.flowClass] : fd.flowClass,
    ]);
  }
  if (fd.flowGroup) out.push(["Flow group", fd.flowGroup]);
  if (fd.counterparty) out.push(["Counterparty", fd.counterparty]);
  if (fd.cost) out.push(["Costs", fd.cost]);
  if (fd.view === "spending") out.push(["View", "Net spending rows"]);
  if (fd.startDate) out.push(["Start date", isoDate(fd.startDate)]);
  if (fd.endDate) out.push(["End date", isoDate(fd.endDate)]);
  if (fd.recurring && fd.recurring !== "all") {
    out.push(["Recurring", fd.recurring]);
  }
  if (fd.spendingType) out.push(["Spending type", fd.spendingType]);
  if (fd.includeTransfers !== undefined) {
    out.push(["Include transfers", fd.includeTransfers ? "true" : "false"]);
  }
  return out;
}

function flowLabel(flowClass: string | null): string {
  if (!flowClass) return "Not classified yet";
  return isFlowClass(flowClass) ? FLOW_CLASS_LABEL[flowClass] : flowClass;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
