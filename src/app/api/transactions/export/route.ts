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
import { parseTransactionQuery } from "@/lib/transactions/query";
import { logError } from "@/lib/logging";

// `searchTransactions` defaults to a paginated 25-row window. The export needs
// every matching row, so we pass an effectively unbounded limit. Personal
// accounts will not approach this number.
const EXPORT_ROW_CEILING = 1_000_000;

const ModeSchema = z.enum(["standard", "detailed"]).catch("standard");

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
  const raw = Object.fromEntries(searchParams);
  const mode = ModeSchema.parse(raw.mode);
  // Same parser as the transactions page, so the file holds exactly the rows
  // (and totals) the user was looking at.
  const query = parseTransactionQuery(raw);
  if (query.invalid.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid query parameters: ${query.invalid.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const prefs = await getUserPreferences(userId);
    const filters: TransactionFilters = {
      ...query.filters,
      includeTransfers: !prefs.hideTransfersFromList,
    };

    const [rows, totals, accounts] = await Promise.all([
      searchTransactions(userId, filters, {
        limit: EXPORT_ROW_CEILING,
        offset: 0,
      }),
      getTransactionTotals(userId, filters),
      filters.accountId ? getAccountsByUserId(userId) : Promise.resolve([]),
    ]);

    const accountName = filters.accountId
      ? accounts.find((a) => a.id === filters.accountId)?.name
      : undefined;

    const generatedAt = new Date();
    const buffer = await buildTransactionsWorkbook({
      mode,
      filterDisplay: {
        search: filters.search,
        accountName,
        category: filters.category,
        bucket: filters.bucket,
        flowClass: filters.flowClass,
        flowGroup: filters.flowGroup,
        counterparty: filters.counterparty,
        cost: filters.cost,
        view: filters.view,
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
    const filename = `transactions_${datePart}${mode === "detailed" ? "_detailed" : ""}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logError("transactions.export_failed", err, { userId });
    return NextResponse.json(
      { success: false, error: "Export failed. Please try again." },
      { status: 500 },
    );
  }
}
