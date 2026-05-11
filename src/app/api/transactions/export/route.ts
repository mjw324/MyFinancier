import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import {
  getTransactionTotals,
  searchTransactions,
  type TransactionFilters,
} from "@/lib/db/queries/transactions";
import { getAccountsByUserId } from "@/lib/db/queries/accounts";
import { getUserPreferences } from "@/lib/db/queries/user-preferences";
import { buildTransactionsWorkbook } from "@/lib/transactions/export";

// `searchTransactions` defaults to a paginated 25-row window. The export needs
// every matching row, so we pass an effectively unbounded limit. Personal
// accounts will not approach this number.
const EXPORT_ROW_CEILING = 1_000_000;

const QuerySchema = z.object({
  mode: z.enum(["standard", "detailed"]).default("standard"),
  search: z.string().optional(),
  account: z.string().optional(),
  category: z.string().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  recurring: z.enum(["recurring", "onetime"]).optional(),
  spendingType: z
    .enum(["necessary", "discretionary", "unclassified"])
    .optional(),
});

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid query parameters" },
      { status: 400 },
    );
  }
  const q = parsed.data;

  const prefs = await getUserPreferences(userId);

  const filters: TransactionFilters = {
    search: q.search || undefined,
    accountId: q.account || undefined,
    category: q.category || undefined,
    startDate: q.from ? new Date(q.from) : undefined,
    endDate: q.to ? new Date(q.to) : undefined,
    recurring: q.recurring,
    spendingType: q.spendingType,
    includeTransfers: !prefs.hideTransfersFromList,
  };

  const [rows, totals, accounts] = await Promise.all([
    searchTransactions(userId, filters, {
      limit: EXPORT_ROW_CEILING,
      offset: 0,
    }),
    getTransactionTotals(userId, filters),
    q.account ? getAccountsByUserId(userId) : Promise.resolve([]),
  ]);

  const accountName = q.account
    ? accounts.find((a) => a.id === q.account)?.name
    : undefined;

  const generatedAt = new Date();
  const buffer = await buildTransactionsWorkbook({
    mode: q.mode,
    filterDisplay: {
      search: filters.search,
      accountName,
      category: filters.category,
      startDate: filters.startDate,
      endDate: filters.endDate,
      recurring: filters.recurring,
      spendingType: filters.spendingType,
      includeTransfers: filters.includeTransfers,
    },
    rows,
    totals,
    generatedAt,
  });

  const datePart = generatedAt.toISOString().slice(0, 10);
  const filename = `transactions_${datePart}${q.mode === "detailed" ? "_detailed" : ""}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
