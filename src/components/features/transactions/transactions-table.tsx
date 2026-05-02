"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { displayName, formatCurrency, formatDate, formatCategory, getCategoryColor } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { RecurringBadge } from "@/components/features/recurring/recurring-badge";
import { TransactionLabel } from "@/components/features/transactions/transaction-label";
import { EditTransactionDialog } from "@/components/features/transactions/edit-transaction-dialog";
import { ClassifyPopover } from "@/components/features/transactions/classify-popover";

interface Transaction {
  id: string;
  name: string;
  merchantName: string | null;
  amount: string;
  date: Date;
  category: string | null;
  customName: string | null;
  customCategory: string | null;
  pending: boolean | null;
  recurringStreamId: string | null;
  spendingType: string | null;
  spendingTypeSource: string | null;
  normalizedMerchant: string | null;
  nameSignature: string | null;
  financialAccount: {
    name: string;
  } | null;
}

interface TransactionsTableProps {
  transactions: Transaction[];
  categories: string[];
}

export function TransactionsTable({
  transactions,
  categories,
}: TransactionsTableProps) {
  const [editing, setEditing] = useState<Transaction | null>(null);

  if (transactions.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">No transactions found</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Spending Type</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((txn) => {
              const amount = parseFloat(txn.amount);
              const isExpense = amount > 0;
              const displayMerchant =
                displayName({
                  customName: txn.customName,
                  merchantName: txn.merchantName,
                }) || null;
              const displayCategory = txn.customCategory ?? txn.category;
              return (
                <TableRow
                  key={txn.id}
                  className={cn(
                    "cursor-pointer",
                    txn.pending && "text-muted-foreground italic",
                  )}
                  onClick={() => setEditing(txn)}
                >
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDate(txn.date)}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <TransactionLabel
                          merchant={displayMerchant}
                          full={txn.name}
                        />
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
                    {displayCategory ? (() => {
                      const color = getCategoryColor(displayCategory);
                      return (
                        <Badge
                          className="text-xs border-0"
                          style={{ backgroundColor: color.bg, color: color.text }}
                        >
                          {formatCategory(displayCategory)}
                        </Badge>
                      );
                    })() : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isExpense ? (
                      <ClassifyPopover
                        transactionId={txn.id}
                        spendingType={txn.spendingType}
                        source={txn.spendingTypeSource}
                        recurringStreamId={txn.recurringStreamId}
                        normalizedMerchant={txn.normalizedMerchant}
                        nameSignature={txn.nameSignature}
                        merchantDisplay={displayMerchant}
                      />
                    ) : (
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

      {editing && (
        <EditTransactionDialog
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          transaction={editing}
          categories={categories}
        />
      )}
    </>
  );
}
