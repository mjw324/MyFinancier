import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, formatCategory, getCategoryColor } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface Transaction {
  id: string;
  name: string;
  merchantName: string | null;
  amount: string;
  date: Date | string;
  category: string | null;
}

interface RecentTransactionsProps {
  transactions: Transaction[];
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Recent Transactions</CardTitle>
        <Link
          href="/transactions"
          className="text-sm text-muted-foreground hover:underline"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet</p>
        ) : (
          <div className="space-y-3">
            {transactions.map((txn) => {
              const amount = parseFloat(txn.amount);
              const isExpense = amount > 0;
              return (
                <div
                  key={txn.id}
                  className="flex items-center justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {txn.merchantName || txn.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(txn.date)}
                      {txn.category && (
                        <>
                          {" · "}
                          <span style={{ color: getCategoryColor(txn.category).text }}>
                            {formatCategory(txn.category)}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "ml-2 text-sm font-medium",
                      isExpense ? "text-foreground" : "text-green-600",
                    )}
                  >
                    {isExpense ? "-" : "+"}
                    {formatCurrency(Math.abs(amount))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
