import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatCategory, getCategoryColor } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { RecurringBadge } from "@/components/features/recurring/recurring-badge";

interface Transaction {
  id: string;
  name: string;
  merchantName: string | null;
  amount: string;
  date: Date;
  category: string | null;
  pending: boolean | null;
  recurringStreamId: string | null;
  financialAccount: {
    name: string;
  } | null;
}

interface TransactionsTableProps {
  transactions: Transaction[];
}

export function TransactionsTable({ transactions }: TransactionsTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">No transactions found</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((txn) => {
            const amount = parseFloat(txn.amount);
            const isExpense = amount > 0;
            return (
              <TableRow key={txn.id}>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDate(txn.date)}
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <span>{txn.merchantName || txn.name}</span>
                      {txn.recurringStreamId && (
                        <RecurringBadge streamId={txn.recurringStreamId} />
                      )}
                    </p>
                    {txn.pending && (
                      <span className="text-xs text-muted-foreground">
                        Pending
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {txn.category ? (() => {
                    const color = getCategoryColor(txn.category);
                    return (
                      <Badge
                        className="text-xs border-0"
                        style={{ backgroundColor: color.bg, color: color.text }}
                      >
                        {formatCategory(txn.category)}
                      </Badge>
                    );
                  })() : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {txn.financialAccount?.name ?? "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right text-sm font-medium",
                    isExpense ? "text-foreground" : "text-green-600",
                  )}
                >
                  {isExpense ? "-" : "+"}
                  {formatCurrency(Math.abs(amount))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
