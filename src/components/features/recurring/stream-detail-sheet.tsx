"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface StreamRow {
  streamId: string;
  description: string;
  merchantName: string | null;
  flowType: "inflow" | "outflow";
  frequency: string;
  status: string;
  isActive: boolean;
  averageAmount: string;
  lastAmount: string;
  predictedNextDate: string | null;
  firstDate: string | null;
  lastDate: string | null;
}

interface StreamTxn {
  id: string;
  date: string;
  amount: string;
  name: string;
  merchantName: string | null;
}

interface ApiResponse {
  success: boolean;
  data?: { stream: StreamRow; transactions: StreamTxn[] };
  error?: string;
}

const PRICE_CHANGE_THRESHOLD = 0.05;

interface StreamDetailSheetProps {
  streamId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function StreamDetailSheet({
  streamId,
  onOpenChange,
}: StreamDetailSheetProps) {
  const [data, setData] = useState<ApiResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!streamId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/recurring-streams/${streamId}`)
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
  }, [streamId]);

  return (
    <Sheet open={streamId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {data?.stream.merchantName ||
              data?.stream.description ||
              "Recurring stream"}
          </SheetTitle>
          <SheetDescription>
            {data?.stream
              ? `${data.stream.flowType === "inflow" ? "Income" : "Bill"} · ${prettyFrequency(data.stream.frequency)}`
              : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {loading && !data && (
            <div className="space-y-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {data && <StreamSummary stream={data.stream} />}

          {data && (
            <div>
              <h4 className="text-sm font-medium mb-2">Recent transactions</h4>
              {data.transactions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No linked transactions yet.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.transactions.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">{t.merchantName || t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(new Date(t.date))}
                        </p>
                      </div>
                      <span className="font-medium">
                        {formatCurrency(Math.abs(parseFloat(t.amount)))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StreamSummary({ stream }: { stream: StreamRow }) {
  const avg = parseFloat(stream.averageAmount);
  const last = parseFloat(stream.lastAmount);
  const priceChanged =
    avg > 0 && Math.abs(last - avg) / avg > PRICE_CHANGE_THRESHOLD;
  const flowLabel = stream.flowType === "inflow" ? "Inflow" : "Outflow";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{prettyFrequency(stream.frequency)}</Badge>
        <Badge
          variant={stream.status === "MATURE" ? "default" : "outline"}
          className={cn(
            stream.status === "EARLY_DETECTION" && "border-dashed",
            stream.status === "TOMBSTONED" && "opacity-60",
          )}
        >
          {stream.status.replace("_", " ")}
        </Badge>
        {!stream.isActive && (
          <Badge variant="outline" className="opacity-60">
            Inactive
          </Badge>
        )}
        {priceChanged && (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            Price change
          </Badge>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{flowLabel} type</dt>
        <dd>{flowLabel}</dd>

        <dt className="text-muted-foreground">Last amount</dt>
        <dd>{formatCurrency(Math.abs(last))}</dd>

        <dt className="text-muted-foreground">Average amount</dt>
        <dd>{formatCurrency(Math.abs(avg))}</dd>

        {stream.predictedNextDate && (
          <>
            <dt className="text-muted-foreground">Next predicted</dt>
            <dd>{formatDate(new Date(stream.predictedNextDate))}</dd>
          </>
        )}
        {stream.lastDate && (
          <>
            <dt className="text-muted-foreground">Last seen</dt>
            <dd>{formatDate(new Date(stream.lastDate))}</dd>
          </>
        )}
        {stream.firstDate && (
          <>
            <dt className="text-muted-foreground">First seen</dt>
            <dd>{formatDate(new Date(stream.firstDate))}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function prettyFrequency(f: string): string {
  switch (f) {
    case "WEEKLY":
      return "Weekly";
    case "BIWEEKLY":
      return "Biweekly";
    case "SEMI_MONTHLY":
      return "Semi-monthly";
    case "MONTHLY":
      return "Monthly";
    case "ANNUALLY":
      return "Annually";
    default:
      return "Unknown frequency";
  }
}
