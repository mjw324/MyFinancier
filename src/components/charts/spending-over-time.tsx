"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils/format";

interface SpendingOverTimeProps {
  data: Array<{
    date: string;
    rawDate: string;
    amount: number;
  }>;
}

const chartConfig = {
  amount: {
    label: "Spending",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function SpendingOverTime({ data }: SpendingOverTimeProps) {
  const router = useRouter();
  const [selectStart, setSelectStart] = useState<string | null>(null);
  const [selectEnd, setSelectEnd] = useState<string | null>(null);

  const dateLabels = Object.fromEntries(
    data.map((d) => [d.rawDate, d.date]),
  );

  const handleMouseDown = useCallback(
    (state: { activeLabel?: string | number }) => {
      if (state?.activeLabel != null) {
        setSelectStart(String(state.activeLabel));
        setSelectEnd(null);
      }
    },
    [],
  );

  const handleMouseMove = useCallback(
    (state: { activeLabel?: string | number }) => {
      if (selectStart && state?.activeLabel != null) {
        setSelectEnd(String(state.activeLabel));
      }
    },
    [selectStart],
  );

  const handleMouseUp = useCallback(() => {
    if (!selectStart) return;

    const end = selectEnd ?? selectStart;
    const [from, to] =
      selectStart <= end ? [selectStart, end] : [end, selectStart];
    router.push(`/transactions?from=${from}&to=${to}`);

    setSelectStart(null);
    setSelectEnd(null);
  }, [selectStart, selectEnd, router]);

  const handleMouseLeave = useCallback(() => {
    setSelectStart(null);
    setSelectEnd(null);
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No spending data yet
      </div>
    );
  }

  return (
    <ChartContainer
      config={chartConfig}
      className="max-h-[300px] w-full [&_.recharts-wrapper]:cursor-crosshair"
    >
      <AreaChart
        data={data}
        margin={{ left: 12, right: 12 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="rawDate"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => dateLabels[value] ?? value}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => `$${value}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatCurrency(Number(value))}
              labelFormatter={(label) => dateLabels[label] ?? label}
            />
          }
        />
        <defs>
          <linearGradient id="fillAmount" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--chart-1)"
              stopOpacity={0.8}
            />
            <stop
              offset="95%"
              stopColor="var(--chart-1)"
              stopOpacity={0.1}
            />
          </linearGradient>
        </defs>
        <Area
          dataKey="amount"
          type="monotone"
          fill="url(#fillAmount)"
          stroke="var(--chart-1)"
          strokeWidth={2}
          activeDot={{ r: 5, className: "cursor-pointer" }}
        />
        {selectStart && selectEnd && selectStart !== selectEnd && (
          <ReferenceArea
            x1={selectStart}
            x2={selectEnd}
            fill="var(--chart-1)"
            fillOpacity={0.1}
            stroke="var(--chart-1)"
            strokeOpacity={0.3}
            strokeDasharray="3 3"
          />
        )}
      </AreaChart>
    </ChartContainer>
  );
}
