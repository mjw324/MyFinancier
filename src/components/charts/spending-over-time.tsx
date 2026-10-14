"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ReferenceArea, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils/format";
import { sumMoney } from "@/lib/utils/money";
import { transactionsHref } from "@/lib/utils/date-ranges";

interface SpendingOverTimeProps {
  /** Dense: one point per calendar day (YYYY-MM-DD), 0 on quiet days. */
  data: Array<{ date: string; net: number }>;
}

const chartConfig = {
  net: { label: "Net spending", color: "var(--chart-1)" },
} satisfies ChartConfig;

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

const compact = (v: number) =>
  Math.abs(v) >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`;

/**
 * Net spending per day — the same figure the transactions totals bar shows
 * for a date range, so dragging across days opens a list whose totals match
 * the selection.
 */
export function SpendingOverTime({ data }: SpendingOverTimeProps) {
  const router = useRouter();
  const [selectStart, setSelectStart] = useState<string | null>(null);
  const [selectEnd, setSelectEnd] = useState<string | null>(null);

  const onDown = useCallback((state: { activeLabel?: string | number }) => {
    if (state?.activeLabel != null) {
      setSelectStart(String(state.activeLabel));
      setSelectEnd(null);
    }
  }, []);

  const onMove = useCallback(
    (state: { activeLabel?: string | number }) => {
      if (selectStart && state?.activeLabel != null) setSelectEnd(String(state.activeLabel));
    },
    [selectStart],
  );

  const onUp = useCallback(() => {
    if (!selectStart) return;
    const end = selectEnd ?? selectStart;
    const [from, to] = selectStart <= end ? [selectStart, end] : [end, selectStart];
    router.push(transactionsHref({ from, to, view: "spending" }));
    setSelectStart(null);
    setSelectEnd(null);
  }, [selectStart, selectEnd, router]);

  const onLeave = useCallback(() => {
    setSelectStart(null);
    setSelectEnd(null);
  }, []);

  const selection = useMemo(() => {
    if (!selectStart || !selectEnd || selectStart === selectEnd) return null;
    const [from, to] = selectStart <= selectEnd ? [selectStart, selectEnd] : [selectEnd, selectStart];
    return {
      from,
      to,
      total: sumMoney(data.filter((d) => d.date >= from && d.date <= to).map((d) => d.net)),
    };
  }, [selectStart, selectEnd, data]);

  if (data.length === 0 || data.every((d) => d.net === 0)) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No spending in this period.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[240px] w-full select-none [&_.recharts-wrapper]:cursor-crosshair"
      >
        <BarChart
          data={data}
          margin={{ left: 4, right: 8, top: 8 }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onLeave}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={dayLabel}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={48}
            tickFormatter={(v) => compact(Number(v))}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)" }}
            content={
              selection ? (
                <SelectionTooltip
                  label={`${dayLabel(selection.from)} – ${dayLabel(selection.to)}`}
                  total={selection.total}
                />
              ) : (
                <ChartTooltipContent
                  labelFormatter={(_, payload) => dayLabel(String(payload?.[0]?.payload?.date ?? ""))}
                  formatter={(value) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">Net spending</span>
                      <span className="font-medium tabular-nums">{formatCurrency(Number(value))}</span>
                    </div>
                  )}
                />
              )
            }
          />
          <Bar
            dataKey="net"
            fill="var(--color-net)"
            radius={[3, 3, 0, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          />
          {selectStart && selectEnd && selectStart !== selectEnd && (
            <ReferenceArea
              x1={selectStart}
              x2={selectEnd}
              fill="var(--chart-1)"
              fillOpacity={0.12}
              stroke="var(--chart-1)"
              strokeOpacity={0.3}
            />
          )}
        </BarChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        Drag across days to open those transactions. Days below zero had more refunds than spending.
      </p>
    </div>
  );
}

function SelectionTooltip({
  active,
  label,
  total,
}: {
  active?: boolean;
  label: string;
  total: number;
}) {
  if (!active) return null;
  return (
    <div className="grid min-w-[8rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{label}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Net spending</span>
        <span className="font-medium tabular-nums">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
