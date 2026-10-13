import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { getStreamTransactionsInRange } from "@/lib/db/queries/recurring";
import { getUserToday } from "@/lib/utils/user-time";
import { loadForecastInput } from "@/lib/forecast/context";
import { forecastWindow } from "@/lib/forecast/safe-to-spend";
import { addUtcDays, utcDay } from "@/lib/plaid/projection";
import { displayName } from "@/lib/utils/format";
import { logError } from "@/lib/logging";

const MAX_WINDOW_DAYS = 92;

/** A real calendar date "YYYY-MM-DD", parsed as UTC midnight. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => new Date(`${s}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

const QuerySchema = z
  .object({ from: calendarDate, to: calendarDate })
  .refine(
    ({ from, to }) => {
      const days = (to.getTime() - from.getTime()) / 86_400_000;
      return days >= 0 && days <= MAX_WINDOW_DAYS;
    },
    { message: `Window must be between 0 and ${MAX_WINDOW_DAYS} days` },
  );

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * GET /api/bill-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Days before the viewer's today show what actually posted for each stream;
 * today onward shows the projection (stale streams skipped, occurrences that
 * already posted not repeated, late ones shown on today).
 */
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

  const userId = session.user.id;
  try {
    const today = utcDay(await getUserToday());
    const { from, to } = parsed.data;
    const input = await loadForecastInput(userId, today);
    const streamById = new Map(input.streams.map((s) => [s.streamId, s]));

    const events: Array<{
      stream_id: string;
      date: string;
      due_date: string;
      amount: number;
      label: string;
      flow_type: "inflow" | "outflow";
      kind: string;
      frequency: string;
      has_price_change: boolean;
      tentative: boolean;
      late: boolean;
      posted: boolean;
    }> = [];

    const pastEnd = addUtcDays(today, -1);
    if (from <= pastEnd && input.streams.length > 0) {
      const posted = await getStreamTransactionsInRange(
        userId,
        input.streams.map((s) => s.streamId),
        from,
        to < pastEnd ? to : pastEnd,
      );
      for (const p of posted) {
        const s = streamById.get(p.streamId);
        if (!s) continue;
        events.push({
          stream_id: p.streamId,
          date: ymd(p.date)!,
          due_date: ymd(p.date)!,
          amount: Math.abs(p.amount),
          label: displayName({
            customName: p.customName ?? s.customName,
            merchantName: p.merchantName ?? s.merchantName,
            fallback: p.name || s.description,
          }),
          flow_type: s.flowType,
          kind: s.flowType === "inflow" ? "inflow" : "outflow",
          frequency: s.frequency,
          has_price_change: false,
          tentative: false,
          late: false,
          posted: true,
        });
      }
    }

    const futureStart = from > today ? from : today;
    const { events: projected, possiblyEnded } = forecastWindow(input, futureStart, to);
    for (const e of projected) {
      events.push({
        stream_id: e.streamId,
        date: ymd(e.date)!,
        due_date: ymd(e.dueDate)!,
        amount: e.amountCents / 100,
        label: e.label,
        flow_type: e.flowType,
        kind: e.kind,
        frequency: e.frequency,
        has_price_change: e.hasPriceChange,
        tentative: e.tentative,
        late: e.late,
        posted: false,
      });
    }

    events.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      success: true,
      data: {
        today: ymd(today),
        events,
        possibly_ended: possiblyEnded.map((p) => ({
          stream_id: p.streamId,
          label: p.label,
          kind: p.kind,
          last_seen: ymd(p.lastSeen),
          expected: ymd(p.expected),
          amount: p.amountCents / 100,
        })),
      },
    });
  } catch (error) {
    logError("bill_calendar.failed", error, { userId });
    return NextResponse.json(
      { success: false, error: "Could not load the bill calendar right now." },
      { status: 500 },
    );
  }
}
