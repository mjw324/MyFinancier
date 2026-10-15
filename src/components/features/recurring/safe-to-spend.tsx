"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/format";
import { StreamDetailSheet } from "./stream-detail-sheet";

interface ForecastItem {
  stream_id: string;
  label: string;
  date: string;
  due_date: string;
  amount: number;
  kind: "bill" | "card_payment" | "income" | "transfer" | "other_inflow";
  late: boolean;
  tentative: boolean;
  has_price_change: boolean;
}

interface SafeToSpendData {
  today: string;
  through: string;
  horizon_source: "next_paycheck" | "default_30d";
  paycheck: ForecastItem | null;
  cash: number;
  cash_accounts: Array<{ id: string; name: string; balance: number; is_stale: boolean }>;
  card_mode: "payment_stream" | "card_balance";
  card_obligations: number;
  card_balances: number;
  bills: number;
  safe_to_spend: number;
  upcoming: ForecastItem[];
  tentative: ForecastItem[];
  possibly_ended: Array<{
    stream_id: string;
    label: string;
    last_seen: string | null;
    expected: string | null;
    amount: number;
  }>;
  excluded_accounts: Array<{ id: string; name: string; reason: "unavailable" | "foreign_currency" }>;
  stale_accounts: Array<{ id: string; name: string; as_of: string | null }>;
}

interface ApiResponse {
  success: boolean;
  data?: SafeToSpendData;
  error?: string;
}

/** "2026-10-20" → "Tue, Oct 20" (calendar date; formatted in UTC so it never shifts). */
function day(ymd: string | null): string {
  if (!ymd) return "—";
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function SafeToSpend() {
  const [data, setData] = useState<SafeToSpendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openStreamId, setOpenStreamId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/safe-to-spend")
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) setData(res.data);
        else setError(res.error ?? "Failed to load");
      })
      .catch(() => {
        if (!cancelled) setError("Could not load safe to spend.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const description = !data
    ? "What you can spend before your next paycheck"
    : data.horizon_source === "next_paycheck"
      ? `Before your next paycheck on ${day(data.paycheck?.date ?? null)}`
      : `Next 30 days, through ${day(data.through)} · no paycheck detected`;

  const notCounted =
    (data?.tentative.length ?? 0) + (data?.possibly_ended.length ?? 0);
  const listCount = (data?.upcoming.length ?? 0) + notCounted;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Safe to spend</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading && !data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : data ? (
          <>
            <div
              className={cn(
                "text-3xl font-semibold tabular-nums",
                data.safe_to_spend < 0 && "text-destructive",
              )}
            >
              {formatCurrency(data.safe_to_spend)}
            </div>

            <dl className="flex flex-col gap-1.5 text-sm">
              <Row
                label={`Cash in ${data.cash_accounts.length} checking/savings account${data.cash_accounts.length === 1 ? "" : "s"}`}
                value={data.cash}
              />
              <Row
                label={`Bills before ${data.horizon_source === "next_paycheck" ? "payday" : day(data.through)} (${data.upcoming.filter((u) => u.kind === "bill").length})`}
                value={-data.bills}
              />
              <Row
                label={
                  data.card_mode === "payment_stream"
                    ? `Card payments due (${data.upcoming.filter((u) => u.kind === "card_payment").length})`
                    : "Card balances (no payment schedule found)"
                }
                value={-data.card_obligations}
              />
            </dl>

            {data.paycheck && (
              <p className="text-xs text-muted-foreground">
                Next paycheck: {data.paycheck.label} ·{" "}
                {formatCurrency(data.paycheck.amount)} expected {day(data.paycheck.date)}{" "}
                (not included)
              </p>
            )}

            {(data.stale_accounts.length > 0 || data.excluded_accounts.length > 0) && (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                {data.stale_accounts.map((a) => (
                  <p key={a.id} className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {a.name}: balance last updated{" "}
                    {a.as_of ? new Date(a.as_of).toLocaleDateString() : "never"}
                  </p>
                ))}
                {data.excluded_accounts.map((a) => (
                  <p key={a.id} className="flex items-start gap-1.5">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    {a.name} not included (
                    {a.reason === "unavailable" ? "balance unavailable" : "not in USD"})
                  </p>
                ))}
              </div>
            )}

            {listCount > 0 && (
              <div className="flex flex-col gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((v) => !v)}
                  className="self-start px-0"
                  aria-expanded={expanded}
                >
                  {expanded ? <ChevronUp /> : <ChevronDown />}
                  {data.upcoming.length} counted
                  {notCounted > 0 && ` · ${notCounted} not counted`}
                </Button>
                {expanded && (
                  <div className="flex flex-col gap-3">
                    {data.upcoming.length > 0 && (
                      <ItemList items={data.upcoming} onOpen={setOpenStreamId} />
                    )}
                    {data.tentative.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          Tentative — newly detected, not counted
                        </p>
                        <ItemList items={data.tentative} onOpen={setOpenStreamId} muted />
                      </div>
                    )}
                    {data.possibly_ended.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          Possibly ended — no charge for over a cycle, not counted
                        </p>
                        <ul className="divide-y rounded-md border">
                          {data.possibly_ended.map((p) => (
                            <li
                              key={p.stream_id}
                              className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-muted-foreground"
                            >
                              <button
                                type="button"
                                onClick={() => setOpenStreamId(p.stream_id)}
                                className="min-w-0 flex-1 text-left hover:underline"
                              >
                                <p className="truncate">{p.label}</p>
                                <p className="text-xs">
                                  Last seen {day(p.last_seen)} · expected {day(p.expected)}
                                </p>
                              </button>
                              <span className="shrink-0 tabular-nums">
                                {formatCurrency(p.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
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

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="shrink-0 font-medium tabular-nums">
        {value < 0 ? "−" : ""}
        {formatCurrency(Math.abs(value))}
      </dd>
    </div>
  );
}

function ItemList({
  items,
  onOpen,
  muted,
}: {
  items: ForecastItem[];
  onOpen: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <ul className="divide-y rounded-md border">
      {items.map((b, i) => (
        <li
          key={`${b.stream_id}-${b.date}-${i}`}
          className={cn(
            "flex items-center justify-between gap-3 px-3 py-2 text-sm",
            muted && "text-muted-foreground",
          )}
        >
          <button
            type="button"
            onClick={() => onOpen(b.stream_id)}
            className="min-w-0 flex-1 text-left hover:underline"
          >
            <p className="truncate font-medium">{b.label}</p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {b.late ? `Was due ${day(b.due_date)}` : day(b.date)}
              {b.kind === "card_payment" && <Badge variant="outline">Card payment</Badge>}
              {b.late && <Badge variant="outline">Late</Badge>}
              {b.has_price_change && <Badge variant="outline">Price changed</Badge>}
            </p>
          </button>
          <span className="shrink-0 font-medium tabular-nums">
            −{formatCurrency(b.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

