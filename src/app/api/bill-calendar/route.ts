import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import {
  getRecentTransactionDatesByStream,
  getStreamTransactionsInRange,
  listRecurringStreams,
  toProjectionInput,
} from "@/lib/db/queries/recurring";
import { projectStreamEvents } from "@/lib/plaid/projection";
import { displayName } from "@/lib/utils/format";

const QuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine(
    ({ from, to }) => {
      const fromDate = new Date(`${from}T00:00:00`);
      const toDate = new Date(`${to}T23:59:59`);
      const diffDays = (toDate.getTime() - fromDate.getTime()) / 86_400_000;
      return diffDays >= 0 && diffDays <= 90;
    },
    { message: "Window must be between 0 and 90 days" },
  );

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid query parameters" },
      { status: 400 },
    );
  }

  const windowStart = new Date(`${parsed.data.from}T00:00:00`);
  const windowEnd = new Date(`${parsed.data.to}T23:59:59`);

  const streams = await listRecurringStreams(session.user.id, {
    activeOnly: true,
  });
  const streamById = new Map(streams.map((s) => [s.streamId, s]));
  const recentDates = await getRecentTransactionDatesByStream(
    session.user.id,
    streams.map((s) => s.streamId),
  );

  // Split window at start-of-today: actual posted transactions for the past
  // portion, projection for the future portion (today included as future so
  // a bill posting today still shows as upcoming until the data syncs).
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  const pastEnd = new Date(
    Math.min(windowEnd.getTime(), startOfToday.getTime() - 1),
  );
  const futureStart = new Date(
    Math.max(windowStart.getTime(), startOfToday.getTime()),
  );

  const events: Array<{
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
  }> = [];

  if (pastEnd >= windowStart) {
    const posted = await getStreamTransactionsInRange(
      session.user.id,
      streams.map((s) => s.streamId),
      windowStart,
      pastEnd,
    );
    for (const p of posted) {
      const s = streamById.get(p.streamId);
      if (!s) continue;
      // Per-transaction overrides take precedence; fall back to the stream's
      // alias so a freshly-edited stream name still wins over Plaid's.
      events.push({
        stream_id: p.streamId,
        date: p.date.toISOString(),
        amount: p.amount,
        label: displayName({
          customName: p.customName ?? s.customName,
          merchantName: p.merchantName ?? s.merchantName,
          fallback: p.name || s.description,
        }),
        flow_type: s.flowType as "inflow" | "outflow",
        frequency: s.frequency,
        status: s.status,
        has_price_change: false,
        tentative: false,
        posted: true,
      });
    }
  }

  if (futureStart <= windowEnd) {
    const projected = streams.flatMap((row) =>
      projectStreamEvents(
        toProjectionInput(row, recentDates.get(row.streamId) ?? []),
        futureStart,
        windowEnd,
      ),
    );
    for (const e of projected) {
      events.push({
        stream_id: e.streamId,
        date: e.date.toISOString(),
        amount: e.amount,
        label: displayName({
          customName: e.customName,
          merchantName: e.merchantName,
          fallback: e.description,
        }),
        flow_type: e.flowType,
        frequency: e.frequency,
        status: e.status,
        has_price_change: e.hasPriceChange,
        tentative: e.tentative,
        posted: false,
      });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ success: true, data: events });
}
