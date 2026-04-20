"use client";

import { useRouter } from "next/navigation";
import { Label, Pie, PieChart, Cell } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency, getCategoryColor } from "@/lib/utils/format";

interface SpendingByCategoryProps {
  data: Array<{
    category: string;
    rawCategory: string;
    amount: number;
  }>;
}

export function SpendingByCategory({ data }: SpendingByCategoryProps) {
  const router = useRouter();

  const chartData = data.map((item) => ({
    ...item,
    fill: getCategoryColor(item.rawCategory).fill,
  }));

  const chartConfig = Object.fromEntries(
    data.map((item) => [
      item.category,
      {
        label: item.category,
        color: getCategoryColor(item.rawCategory).fill,
      },
    ]),
  ) satisfies ChartConfig;

  const total = data.reduce((sum, item) => sum + item.amount, 0);

  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No spending data yet
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center">
      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square w-full max-w-[300px]"
      >
        <PieChart>
          <ChartTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const item = payload[0];
            const { category, rawCategory } = item.payload;
            const amount = Number(item.value);
            const color = getCategoryColor(rawCategory);
            return (
              <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                <p className="font-bold" style={{ color: color.fill }}>
                  {category}
                </p>
                <p className="mt-1 font-mono font-medium tabular-nums">
                  {formatCurrency(amount)}
                </p>
              </div>
            );
          }}
        />
        <Pie
          data={chartData}
          dataKey="amount"
          nameKey="category"
          innerRadius={60}
          strokeWidth={5}
          minAngle={8}
          onClick={(_, index) => {
            const raw = chartData[index]?.rawCategory;
            if (raw) {
              router.push(`/transactions?category=${encodeURIComponent(raw)}`);
            }
          }}
          style={{ cursor: "pointer" }}
        >
          {chartData.map((entry) => (
            <Cell key={entry.category} fill={entry.fill} />
          ))}
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                return null;
              }
              const { cx, cy } = viewBox as { cx: number; cy: number };
              const totalFontSize = total >= 10000 ? 20 : 24;
              const labelFontSize = 14;
              const gap = 2;
              const totalY = cy - labelFontSize / 2 - gap / 2;
              const labelY = cy + totalFontSize / 2 + gap / 2;
              return (
                <text textAnchor="middle">
                  <tspan
                    x={cx}
                    y={totalY}
                    dominantBaseline="middle"
                    className={`fill-foreground font-bold tabular-nums ${total >= 10000 ? "text-xl" : "text-2xl"}`}
                  >
                    {formatCurrency(total)}
                  </tspan>
                  <tspan
                    x={cx}
                    y={labelY}
                    dominantBaseline="middle"
                    className="fill-muted-foreground text-sm"
                  >
                    Total
                  </tspan>
                </text>
              );
            }}
          />
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
        {data.map((item) => (
          <div key={item.rawCategory} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: getCategoryColor(item.rawCategory).fill }}
            />
            <span className="text-muted-foreground">{item.category}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
