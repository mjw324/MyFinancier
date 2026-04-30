import { formatCurrency } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface TransactionTotalsProps {
  count: number;
  income: number;
  expenses: number;
  net: number;
}

export function TransactionTotals({
  count,
  income,
  expenses,
  net,
}: TransactionTotalsProps) {
  const netIsPositive = net < 0;
  const netIsZero = net === 0;
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-4">
      <Stat label="Transactions" value={count.toLocaleString()} />
      <Stat
        label="Income"
        value={income === 0 ? "—" : formatCurrency(income)}
        className={income === 0 ? "text-muted-foreground" : "text-green-600"}
      />
      <Stat
        label="Expenses"
        value={expenses === 0 ? "—" : formatCurrency(expenses)}
        className={expenses === 0 ? "text-muted-foreground" : "text-red-600"}
      />
      <Stat
        label="Net"
        value={
          netIsZero
            ? "—"
            : `${netIsPositive ? "+" : "-"}${formatCurrency(Math.abs(net))}`
        }
        className={cn(
          netIsZero && "text-muted-foreground",
          netIsPositive && "text-green-600",
          !netIsZero && !netIsPositive && "text-red-600",
        )}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", className)}>
        {value}
      </p>
    </div>
  );
}
