import { formatCurrency } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface TransactionTotalsProps {
  /** Rows matching the filters (the list's count). */
  count: number;
  moneyIn: number;
  netSpending: number;
  offsets: number;
  savedNet: number;
  /** moneyIn − netSpending − savedNet. Positive = more came in. */
  netChange: number;
  /** Rows in the list that no total counts (unclassified or stale pending). */
  uncounted: number;
  /** Savings rows are hidden by the list preference, so saved/moved is 0 here. */
  transfersHidden: boolean;
}

/**
 * Totals for exactly the rows listed below, from the same metric as the
 * dashboard's cash-flow card (src/lib/analytics/metrics.ts).
 */
export function TransactionTotals({
  count,
  moneyIn,
  netSpending,
  offsets,
  savedNet,
  netChange,
  uncounted,
  transfersHidden,
}: TransactionTotalsProps) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5">
      <Stat
        label="Transactions"
        value={count.toLocaleString()}
        note={uncounted > 0 ? `${uncounted} not counted in totals` : undefined}
      />
      <Stat label="Money in" value={moneyIn === 0 ? "—" : formatCurrency(moneyIn)} />
      <Stat
        label="Spending (net)"
        value={netSpending === 0 ? "—" : formatCurrency(netSpending)}
        note={offsets > 0 ? `after ${formatCurrency(offsets)} back` : undefined}
      />
      <Stat
        label="Saved / moved"
        value={transfersHidden ? "Hidden" : savedNet === 0 ? "—" : formatCurrency(savedNet)}
        note={transfersHidden ? "Transfers are hidden in your list settings" : undefined}
      />
      <Stat
        label="Net (in − out)"
        value={
          netChange === 0
            ? "—"
            : `${netChange > 0 ? "+" : "−"}${formatCurrency(Math.abs(netChange))}`
        }
        className={cn(netChange < 0 && "text-destructive")}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", className)}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
