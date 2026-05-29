"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils/format";
import { StreamDetailSheet } from "./stream-detail-sheet";

interface BillEvent {
  stream_id: string;
  date: string;
  amount: number;
  label: string;
  flow_type: "inflow" | "outflow";
  frequency: string;
  status: string;
  has_price_change: boolean;
  tentative: boolean;
  posted: boolean;
}

function formatBadgeAmount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    // Intl compact emits "$1.2K"; lowercase the suffix to match the
    // requested "$1.2k" style.
    return formatCompactCurrency(abs).replace(/([KMB])$/, (s) =>
      s.toLowerCase(),
    );
  }
  return `$${Math.round(abs)}`;
}

interface ApiResponse {
  success: boolean;
  data?: BillEvent[];
  error?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function BillCalendar() {
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [events, setEvents] = useState<BillEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStreamId, setOpenStreamId] = useState<string | null>(null);

  const monthLabel = monthAnchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  useEffect(() => {
    const from = isoDate(monthAnchor);
    const to = isoDate(endOfMonth(monthAnchor));
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/bill-calendar?from=${from}&to=${to}`)
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setEvents(res.data);
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
  }, [monthAnchor]);

  const cells = useMemo(() => buildMonthCells(monthAnchor, events), [
    monthAnchor,
    events,
  ]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Bill calendar</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-medium w-32 text-center">
            {monthLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-2">{error}</p>}
        <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden text-xs">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="bg-muted/50 px-2 py-1 text-center font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}
          {cells.map((cell, i) => (
            <div
              key={i}
              className={cn(
                "bg-card min-h-[72px] p-1.5 flex flex-col gap-1 relative",
                !cell.inMonth && "bg-muted/20",
                cell.isToday && "ring-2 ring-primary ring-inset",
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-medium inline-flex items-center justify-center",
                  cell.isToday &&
                    "size-4 rounded-full bg-primary text-primary-foreground",
                  !cell.isToday && !cell.inMonth && "text-muted-foreground/60",
                )}
              >
                {cell.date.getDate()}
              </span>
              {loading && cell.inMonth && i % 7 === 3 && (
                <Skeleton className="h-3 w-full" />
              )}
              {cell.events.map((e) => {
                const isPast = e.posted;
                const inflowFuture =
                  "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400";
                const outflowFuture =
                  "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400";
                const inflowPast =
                  "border-green-500/25 bg-green-500/5 text-green-700/60 dark:text-green-400/55 saturate-50";
                const outflowPast =
                  "border-rose-500/25 bg-rose-500/5 text-rose-700/60 dark:text-rose-400/55 saturate-50";
                const tone =
                  e.flow_type === "inflow"
                    ? isPast
                      ? inflowPast
                      : inflowFuture
                    : isPast
                      ? outflowPast
                      : outflowFuture;
                return (
                  <button
                    key={`${e.stream_id}-${e.date}`}
                    type="button"
                    onClick={() => setOpenStreamId(e.stream_id)}
                    className={cn(
                      "text-left text-[10px] leading-tight rounded px-1 py-0.5 border flex items-center gap-1 min-w-0",
                      tone,
                      e.tentative && "border-dashed",
                    )}
                    title={`${e.label} · ${formatCurrency(Math.abs(e.amount))}`}
                  >
                    <span className="truncate flex-1 min-w-0">{e.label}</span>
                    {e.has_price_change && (
                      <span className="inline-block size-1.5 rounded-full bg-amber-500 shrink-0" />
                    )}
                    <span className="shrink-0 tabular-nums font-medium">
                      {formatBadgeAmount(e.amount)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </CardContent>
      <StreamDetailSheet
        streamId={openStreamId}
        onOpenChange={(o) => !o && setOpenStreamId(null)}
      />
    </Card>
  );
}

interface DayCell {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  events: BillEvent[];
}

function buildMonthCells(monthAnchor: Date, events: BillEvent[]): DayCell[] {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  const eventsByDay = new Map<string, BillEvent[]>();
  for (const e of events) {
    // e.date is a calendar date the API serialized as UTC-midnight ISO
    // (e.g. "2026-05-27T00:00:00.000Z"). Read its UTC components so the bill
    // lands on its intended day — local getters would roll it back a day for
    // viewers behind UTC. Cell keys below use local components, which represent
    // the same intended calendar day, so the two line up.
    const ed = new Date(e.date);
    const key = `${ed.getUTCFullYear()}-${ed.getUTCMonth()}-${ed.getUTCDate()}`;
    const list = eventsByDay.get(key) ?? [];
    list.push(e);
    eventsByDay.set(key, list);
  }

  const today = new Date();
  const cells: DayCell[] = [];
  // leading days from previous month
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({
      date: d,
      inMonth: false,
      isToday: sameDay(d, today),
      events: [],
    });
  }
  for (let day = 1; day <= lastDayOfMonth; day++) {
    const d = new Date(year, month, day);
    cells.push({
      date: d,
      inMonth: true,
      isToday: sameDay(d, today),
      events: eventsByDay.get(`${year}-${month}-${day}`) ?? [],
    });
  }
  // trailing fill to complete final week (multiple of 7)
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push({
      date: next,
      inMonth: false,
      isToday: sameDay(next, today),
      events: [],
    });
  }
  return cells;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
