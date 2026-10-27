import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/get-session";
import {
  searchTransactions,
  getTransactionCount,
  getTransactionTotals,
  getDistinctCategories,
  hasActiveFilters,
  type TransactionFilters,
} from "@/lib/db/queries/transactions";
import { getAccountsByUserId } from "@/lib/db/queries/accounts";
import { getUserPreferences } from "@/lib/db/queries/user-preferences";
import { FLOW_CLASS_LABEL } from "@/lib/analytics/flow";
import { bucketLabel } from "@/lib/analytics/labels";
import { formatCurrency } from "@/lib/utils/format";
import {
  parseTransactionQuery,
  type ParsedTransactionQuery,
} from "@/lib/transactions/query";
import {
  TransactionFilters as TransactionFiltersUI,
  type FilterChip,
} from "@/components/features/transactions/transaction-filters";
import { TransactionsTable } from "@/components/features/transactions/transactions-table";
import { TransactionTotals } from "@/components/features/transactions/transaction-totals";
import { Pagination } from "@/components/features/transactions/pagination";
import { ExportButton } from "@/components/features/transactions/export-button";
import { Button } from "@/components/ui/button";
import { isAiActiveForUser } from "@/lib/ai/consent";
import { countPendingSuggestions } from "@/lib/categorize/review";
import { AskSearch } from "./_components/ask-search";

export const metadata: Metadata = {
  title: "MyFinancier — Transactions",
};

const PAGE_SIZE = 25;

/** Chips for drill-down filters that have no dedicated control. */
function drillDownChips(q: ParsedTransactionQuery): FilterChip[] {
  const f = q.filters;
  const chips: FilterChip[] = [];
  if (f.bucket) chips.push({ param: "bucket", label: `Spending: ${bucketLabel(f.bucket)}` });
  if (f.flowClass) chips.push({ param: "flowClass", label: FLOW_CLASS_LABEL[f.flowClass] });
  if (f.counterparty) chips.push({ param: "counterparty", label: `Merchant: ${f.counterparty}` });
  if (f.view === "spending") {
    chips.push({ param: "view", label: "Spending, net of refunds & reimbursements" });
  }
  if (f.cost) chips.push({ param: "cost", label: f.cost === "fixed" ? "Fixed costs" : "Variable costs" });
  if (f.minAmount !== undefined) chips.push({ param: "min", label: `At least ${formatCurrency(f.minAmount)}` });
  if (f.maxAmount !== undefined) chips.push({ param: "max", label: `At most ${formatCurrency(f.maxAmount)}` });
  return chips;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session?.user) redirect("/signin");
  const userId = session.user.id;

  const query = parseTransactionQuery(await searchParams);
  const prefs = await getUserPreferences(userId);

  const filters: TransactionFilters = {
    ...query.filters,
    includeTransfers: !prefs.hideTransfersFromList,
  };

  const currentPage = query.page;
  const offset = (currentPage - 1) * PAGE_SIZE;
  const filtersActive = hasActiveFilters(filters);

  const [transactions, totalCount, accounts, categoryNames, totals, aiActive] =
    await Promise.all([
      searchTransactions(userId, filters, { limit: PAGE_SIZE, offset }),
      getTransactionCount(userId, filters),
      getAccountsByUserId(userId),
      getDistinctCategories(userId),
      filtersActive ? getTransactionTotals(userId, filters) : null,
      isAiActiveForUser(userId),
    ]);
  const pendingReview = aiActive ? await countPendingSuggestions(userId) : 0;

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const categoryOptions = categoryNames.map((name) => ({ id: name, name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Transactions</h2>
          <p className="text-sm text-muted-foreground">
            {totalCount} transaction{totalCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {aiActive && (
            <Button asChild variant="outline" size="sm">
              <Link href="/transactions/review">
                Review categories{pendingReview > 0 ? ` (${pendingReview})` : ""}
              </Link>
            </Button>
          )}
          <ExportButton count={totalCount} />
        </div>
      </div>

      {aiActive && <AskSearch />}

      <TransactionFiltersUI
        accounts={accountOptions}
        categories={categoryOptions}
        chips={drillDownChips(query)}
      />

      {query.invalid.length > 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          Ignored an invalid filter value for: {query.invalid.join(", ")}.
        </p>
      )}

      {totals && (
        <TransactionTotals
          count={totals.count}
          moneyIn={totals.moneyIn}
          netSpending={totals.netSpending}
          offsets={totals.offsets}
          savedNet={totals.savedNet}
          netChange={totals.netChange}
          uncounted={totals.unclassifiedCount + totals.stalePendingCount}
          transfersHidden={prefs.hideTransfersFromList}
        />
      )}

      <TransactionsTable
        transactions={transactions}
        categories={categoryNames}
        flowLabels={FLOW_CLASS_LABEL}
      />

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath="/transactions"
        searchParams={query.params}
      />
    </div>
  );
}
