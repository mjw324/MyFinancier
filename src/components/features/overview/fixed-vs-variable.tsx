import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { formatRatio } from "@/lib/analytics/labels";
import type { FixedVsVariable as FixedVsVariableData } from "@/lib/analytics/metrics";
import { transactionsHref } from "@/lib/utils/date-ranges";

/**
 * Fixed costs (rent, loans, insurance, recurring bills) against everything
 * else. The fixed number is what "can I afford this" has to be measured
 * against; the variable number is what can actually change this month.
 */
export function FixedVsVariable({
  data,
  range,
  title,
}: {
  data: FixedVsVariableData;
  range: { from: string; to: string };
  title: string;
}) {
  const share = data.fixedShare;
  const width = share === null ? 0 : Math.min(100, Math.max(0, share * 100));

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Fixed vs variable</CardTitle>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent className="@container flex flex-col gap-4">
        {data.total === 0 && data.fixed === 0 ? (
          <p className="text-sm text-muted-foreground">No spending in this period.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
              <Link
                href={transactionsHref({ ...range, cost: "fixed" })}
                className="rounded-lg border p-3 hover:bg-muted/40"
              >
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-chart-1" aria-hidden />
                  Fixed
                </p>
                <p className="mt-1 text-xl font-semibold">{formatCurrency(data.fixed)}</p>
              </Link>
              <Link
                href={transactionsHref({ ...range, cost: "variable" })}
                className="rounded-lg border p-3 hover:bg-muted/40"
              >
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden />
                  Variable
                </p>
                <p className="mt-1 text-xl font-semibold">{formatCurrency(data.variable)}</p>
              </Link>
            </div>
            {share !== null && (
              <div className="flex flex-col gap-1.5">
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(width)}
                  aria-label="Fixed share of spending"
                >
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${width}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatRatio(share)} of net spending is fixed
                </p>
              </div>
            )}
            {data.fixedItems.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Largest fixed costs</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {data.fixedItems.map((item) => (
                    <li key={item.key} className="flex items-baseline justify-between gap-3 text-sm">
                      <Link
                        href={transactionsHref({ ...range, counterparty: item.key, cost: "fixed" })}
                        className="min-w-0 truncate hover:underline"
                      >
                        {item.label}
                      </Link>
                      <span className="shrink-0 tabular-nums">{formatCurrency(item.total)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
