"use client";

import Link from "next/link";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils/format";
import { formatMoneyShort, formatRatio } from "@/lib/analytics/labels";

interface Split {
  total: number;
  fixed: number;
  variable: number;
}

export interface SpendingPaceProps {
  monthLabel: string;
  comparisonLabel: string;
  elapsedDays: number;
  totalDays: number;
  series: Array<{ day: number; current: number | null; comparison: number | null }>;
  toDate: Split;
  comparisonToDate: Split;
  comparisonTotal: Split;
  projected: Split;
  variableRatioAhead: number | null;
  /** Drill-down to this month's variable spending. */
  href: string;
}

const compact = (v: number) =>
  Math.abs(v) >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`;

/**
 * Cumulative spending this month against the same day last month. The
 * projection keeps fixed costs at last month's level and only extrapolates
 * day-to-day spending, so rent on the 1st doesn't project a $9,000 month.
 */
export function SpendingPace(props: SpendingPaceProps) {
  const {
    monthLabel,
    comparisonLabel,
    elapsedDays,
    totalDays,
    series,
    toDate,
    comparisonToDate,
    comparisonTotal,
    projected,
    variableRatioAhead,
    href,
  } = props;

  const config = {
    current: { label: monthLabel, color: "var(--chart-1)" },
    comparison: { label: comparisonLabel, color: "var(--muted-foreground)" },
  } satisfies ChartConfig;

  const hasData = toDate.total !== 0 || comparisonTotal.total !== 0;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Pace</CardTitle>
        <CardDescription>
          {monthLabel} · day {elapsedDays} of {totalDays}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hasData ? (
          <p className="text-sm text-muted-foreground">No spending this month or last yet.</p>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-semibold">{formatCurrency(toDate.total)}</span>{" "}
              <span className="text-muted-foreground">
                spent so far, against {formatCurrency(comparisonToDate.total)} by day {elapsedDays}{" "}
                of {comparisonLabel}.
              </span>{" "}
              {variableRatioAhead !== null && (
                <Link href={href} className="underline-offset-2 hover:underline">
                  Day-to-day spending is {formatRatio(variableRatioAhead)}{" "}
                  {variableRatioAhead >= 0 ? "higher" : "lower"}.
                </Link>
              )}
            </p>

            <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
              <LineChart data={series} margin={{ left: 4, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  width={48}
                  tickFormatter={(v) => compact(Number(v))}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => `Day ${payload?.[0]?.payload?.day ?? ""}`}
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-3">
                          <span className="text-muted-foreground">
                            {config[name as keyof typeof config]?.label ?? name}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  dataKey="comparison"
                  type="monotone"
                  stroke="var(--color-comparison)"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  dataKey="current"
                  type="monotone"
                  stroke="var(--color-current)"
                  strokeWidth={2}
                  dot={false}
                  // Null after today: leave the rest of the month blank.
                  connectNulls={false}
                />
              </LineChart>
            </ChartContainer>

            <dl className="grid grid-cols-3 gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">On track for</dt>
                <dd className="font-semibold tabular-nums">{formatMoneyShort(projected.total)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Fixed</dt>
                <dd className="tabular-nums">{formatMoneyShort(projected.fixed)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Day-to-day</dt>
                <dd className="tabular-nums">{formatMoneyShort(projected.variable)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {comparisonLabel} ended at {formatMoneyShort(comparisonTotal.total)}. Fixed costs are
              projected at last month&rsquo;s level; only day-to-day spending is extrapolated.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
