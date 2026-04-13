import { type Metadata } from "next";
import { getServerSession } from "@/lib/auth/get-session";
import {
  searchTransactions,
  getTransactionCount,
  getDistinctCategories,
  type TransactionFilters,
} from "@/lib/db/queries/transactions";
import { getAccountsByUserId } from "@/lib/db/queries/accounts";
import { TransactionFilters as TransactionFiltersUI } from "@/components/features/transactions/transaction-filters";
import { TransactionsTable } from "@/components/features/transactions/transactions-table";
import { Pagination } from "@/components/features/transactions/pagination";

export const metadata: Metadata = {
  title: "MyFinancier — Transactions",
};

const PAGE_SIZE = 25;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getServerSession();
  const userId = session!.user.id;
  const params = await searchParams;

  const filters: TransactionFilters = {
    search: params.search || undefined,
    accountId: params.account || undefined,
    category: params.category || undefined,
    startDate: params.from ? new Date(params.from) : undefined,
    endDate: params.to ? new Date(params.to) : undefined,
  };

  const currentPage = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const [transactions, totalCount, accounts, categoryNames] = await Promise.all([
    searchTransactions(userId, filters, { limit: PAGE_SIZE, offset }),
    getTransactionCount(userId, filters),
    getAccountsByUserId(userId),
    getDistinctCategories(userId),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const categoryOptions = categoryNames.map((name) => ({ id: name, name }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Transactions</h2>
        <p className="text-sm text-muted-foreground">
          {totalCount} transaction{totalCount !== 1 ? "s" : ""}
        </p>
      </div>

      <TransactionFiltersUI
        accounts={accountOptions}
        categories={categoryOptions}
      />

      <TransactionsTable transactions={transactions} />

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath="/transactions"
        searchParams={params}
      />
    </div>
  );
}
