"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { StreamDetailSheet } from "./stream-detail-sheet";

interface UpcomingBill {
  stream_id: string;
  date: string;
  amount: number;
  merchant_name: string | null;
  description: string;
  flow_type: "inflow" | "outflow";
  has_price_change: boolean;
  tentative: boolean;
}

interface SafeToSpendData {
  current_balance: number;
  predicted_inflows: number;
  predicted_outflows: number;
  safe_to_spend: number;
  through: string;
  horizon_source: string;
  upcoming_bills: UpcomingBill[];
}

interface ApiResponse {
  success: boolean;
  data?: SafeToSpendData;
  error?: string;
}

type Horizon = "next_paycheck" | "30_days" | "end_of_month";

export function SafeToSpend() {
  const [horizon, setHorizon] = useState<Horizon>("next_paycheck");
  const [data, setData] = useState<SafeToSpendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openStreamId, setOpenStreamId] = useState<string | null>(null);

  const through = useMemo(() => horizonToThrough(horizon), [horizon]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url =
      through === null
        ? "/api/safe-to-spend"
        : `/api/safe-to-spend?through=${through}`;
    fetch(url)
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setData(res.data);
        } else {
          setError(res.error ?? "Failed to load");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [through]);

  const isNegative = data ? data.safe_to_spend < 0 : false;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 gap-2">
        <CardTitle className="text-base">Safe to spend</CardTitle>
        <Select
          value={horizon}
          onValueChange={(v) => setHorizon(v as Horizon)}
        >
          <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="next_paycheck">Next paycheck</SelectItem>
            <SelectItem value="30_days">30 days</SelectItem>
            <SelectItem value="end_of_month">End of month</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : data ? (
          <>
            <div
              className={cn(
                "text-3xl font-semibold tabular-nums",
                isNegative && "text-rose-600 dark:text-rose-400",
              )}
            >
              {formatCurrency(data.safe_to_spend)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              after {formatCurrency(data.predicted_outflows)} in upcoming bills
              through {formatDate(new Date(data.through))}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <Stat label="Balance" value={data.current_balance} />
              <Stat
                label="Inflows"
                value={data.predicted_inflows}
                positive
              />
              <Stat
                label="Outflows"
                value={data.predicted_outflows}
                negative
              />
            </div>

            {data.upcoming_bills.length > 0 && (
              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((v) => !v)}
                  className="px-0"
                >
                  {expanded ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                  {data.upcoming_bills.length} upcoming
                </Button>
                {expanded && (
                  <ul className="mt-2 divide-y rounded-md border">
                    {data.upcoming_bills.map((b, i) => (
                      <li
                        key={`${b.stream_id}-${b.date}-${i}`}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <button
                          type="button"
                          onClick={() => setOpenStreamId(b.stream_id)}
                          className="text-left flex-1 hover:underline"
                        >
                          <p className="font-medium">
                            {b.merchant_name || b.description}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(new Date(b.date))}
                            {b.tentative && " · tentative"}
                          </p>
                        </button>
                        <span
                          className={cn(
                            "font-medium tabular-nums",
                            b.flow_type === "inflow"
                              ? "text-green-600 dark:text-green-400"
                              : "text-foreground",
                          )}
                        >
                          {b.flow_type === "inflow" ? "+" : "-"}
                          {formatCurrency(Math.abs(b.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
      <StreamDetailSheet
        streamId={openStreamId}
        onOpenChange={(o) => !o && setOpenStreamId(null)}
      />
    </Card>
  );
}

function Stat({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-medium tabular-nums mt-0.5",
          positive && "text-green-600 dark:text-green-400",
          negative && "text-rose-600 dark:text-rose-400",
        )}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function horizonToThrough(horizon: Horizon): string | null {
  if (horizon === "next_paycheck") return null; // server picks
  const today = new Date();
  if (horizon === "30_days") {
    const d = new Date(today);
    d.setDate(d.getDate() + 30);
    return iso(d);
  }
  // end_of_month
  const d = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return iso(d);
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
