import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { getAccountsWithBalances } from "@/lib/db/queries/accounts";
import {
  getRecentTransactionDatesByStream,
  listRecurringStreams,
  toProjectionInput,
} from "@/lib/db/queries/recurring";
import { projectStreamEvents } from "@/lib/plaid/projection";

const QuerySchema = z.object({
  through: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

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
  const today = startOfDay(new Date());

  const streams = await listRecurringStreams(userId, { activeOnly: true });
  const recentDates = await getRecentTransactionDatesByStream(
    userId,
    streams.map((s) => s.streamId),
  );

  let through: Date;
  let horizonSource: "explicit" | "next_inflow" | "default_30d";
  if (parsed.data.through) {
    through = new Date(`${parsed.data.through}T23:59:59`);
    horizonSource = "explicit";
  } else {
    const candidate = nextInflowWithin(streams, today, 35);
    if (candidate) {
      through = endOfDay(candidate);
      horizonSource = "next_inflow";
    } else {
      through = endOfDay(addDays(today, 30));
      horizonSource = "default_30d";
    }
  }

  const events = streams.flatMap((row) =>
    projectStreamEvents(
      toProjectionInput(row, recentDates.get(row.streamId) ?? []),
      today,
      through,
    ),
  );

  let predictedInflows = 0;
  let predictedOutflows = 0;
  for (const e of events) {
    if (e.flowType === "inflow") predictedInflows += Math.abs(e.amount);
    else predictedOutflows += Math.abs(e.amount);
  }

  const accounts = await getAccountsWithBalances(userId);
  const settledBalance = accounts.reduce((s, a) => s + a.netWorthSettled, 0);
  const projectedBalance = accounts.reduce(
    (s, a) => s + a.netWorthProjected,
    0,
  );

  const safeToSpend =
    projectedBalance + predictedInflows - predictedOutflows;

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  return NextResponse.json({
    success: true,
    data: {
      current_balance: settledBalance,
      projected_balance: projectedBalance,
      predicted_inflows: predictedInflows,
      predicted_outflows: predictedOutflows,
      safe_to_spend: safeToSpend,
      through: through.toISOString(),
      horizon_source: horizonSource,
      upcoming_bills: events.map((e) => ({
        stream_id: e.streamId,
        date: e.date.toISOString(),
        amount: e.amount,
        merchant_name: e.merchantName,
        description: e.description,
        flow_type: e.flowType,
        frequency: e.frequency,
        status: e.status,
        has_price_change: e.hasPriceChange,
        tentative: e.tentative,
      })),
    },
  });
}

function nextInflowWithin(
  streams: Awaited<ReturnType<typeof listRecurringStreams>>,
  from: Date,
  days: number,
): Date | null {
  const limit = addDays(from, days);
  let best: Date | null = null;
  for (const s of streams) {
    if (s.flowType !== "inflow") continue;
    if (!s.predictedNextDate) continue;
    if (s.predictedNextDate < from) continue;
    if (s.predictedNextDate > limit) continue;
    if (!best || s.predictedNextDate < best) best = s.predictedNextDate;
  }
  return best;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
