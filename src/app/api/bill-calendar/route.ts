import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import {
  getRecentTransactionDatesByStream,
  listRecurringStreams,
  toProjectionInput,
} from "@/lib/db/queries/recurring";
import { projectStreamEvents } from "@/lib/plaid/projection";

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
  const recentDates = await getRecentTransactionDatesByStream(
    session.user.id,
    streams.map((s) => s.streamId),
  );

  const events = streams.flatMap((row) =>
    projectStreamEvents(
      toProjectionInput(row, recentDates.get(row.streamId) ?? []),
      windowStart,
      windowEnd,
    ),
  );
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  return NextResponse.json({
    success: true,
    data: events.map((e) => ({
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
  });
}
