"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils/format";

interface BudgetProgressChartProps {
  data: Array<{
    category: string;
    budgeted: number;
    spent: number;
  }>;
}

const chartConfig = {
  budgeted: {
    label: "Budgeted",
    color: "var(--chart-2)",
  },
  spent: {
    label: "Spent",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function BudgetProgressChart({ data }: BudgetProgressChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No budgets set up yet
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="max-h-[350px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 12 }}>
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `$${value}`}
        />
        <YAxis
          dataKey="category"
          type="category"
          tickLine={false}
          axisLine={false}
          width={100}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatCurrency(Number(value))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="budgeted" fill="var(--chart-2)" radius={4} />
        <Bar dataKey="spent" fill="var(--chart-1)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
