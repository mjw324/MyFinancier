"use client";

import Link from "next/link";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils/format";
import type {
  SpendingTypePercentages,
  SpendingTypeTotals,
} from "@/lib/utils/aggregations";

interface NecessaryVsDiscretionaryProps {
  totals: SpendingTypeTotals;
  percentages: SpendingTypePercentages;
}

const COLORS = {
  necessary: "var(--chart-2, oklch(0.74 0.16 145))",
  discretionary: "var(--chart-3, oklch(0.78 0.13 75))",
  unclassified: "var(--muted-foreground)",
};

export function NecessaryVsDiscretionary({
  totals,
  percentages,
}: NecessaryVsDiscretionaryProps) {
  const data = [
    {
      key: "necessary",
      label: "Necessary",
      amount: totals.necessary,
      pct: percentages.necessary,
      fill: COLORS.necessary,
    },
    {
      key: "discretionary",
      label: "Discretionary",
      amount: totals.discretionary,
      pct: percentages.discretionary,
      fill: COLORS.discretionary,
    },
    {
      key: "unclassified",
      label: "Unclassified",
      amount: totals.unclassified,
      pct: percentages.unclassified,
      fill: COLORS.unclassified,
    },
  ];

  const chartConfig = {
    necessary: { label: "Necessary", color: COLORS.necessary },
    discretionary: { label: "Discretionary", color: COLORS.discretionary },
    unclassified: { label: "Unclassified", color: COLORS.unclassified },
  } satisfies ChartConfig;

  const showCta =
    totals.totalExpenses > 0 &&
    totals.unclassified / totals.totalExpenses > 0.15;

  const summary =
    totals.income > 0
      ? `${percentages.necessary ?? 0}% of your income covers necessities, ${percentages.discretionary ?? 0}% goes to discretionary spending, ${percentages.unclassified ?? 0}% is unclassified.`
      : "Connect income transactions to see how this stacks up against earnings.";

  if (totals.totalExpenses === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Necessary vs Discretionary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No spending in this period.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Necessary vs Discretionary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ChartContainer config={chartConfig} className="h-[180px] w-full">
          <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={110}
              tickLine={false}
              axisLine={false}
              fontSize={12}
            />
            <ChartTooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
                    <div className="font-medium">{p.label}</div>
                    <div>{formatCurrency(p.amount)}</div>
                    {p.pct != null && <div>{p.pct}% of income</div>}
                  </div>
                );
              }}
            />
            <Bar dataKey="amount" radius={4}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.fill} />
              ))}
              <LabelList
                dataKey="amount"
                position="right"
                formatter={(v) => formatCurrency(Number(v ?? 0))}
                fontSize={11}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
        <p className="text-xs text-muted-foreground">{summary}</p>
        {showCta && (
          <Link
            href="/transactions?spendingType=unclassified"
            className="inline-block text-xs text-muted-foreground underline hover:text-foreground"
          >
            Classify unclassified transactions to sharpen this view.
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
