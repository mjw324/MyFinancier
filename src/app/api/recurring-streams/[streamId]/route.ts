import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import {
  getRecurringStream,
  getStreamTransactions,
} from "@/lib/db/queries/recurring";

// Plaid stream ids are opaque alphanumeric strings.
const ParamsSchema = z.object({
  streamId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid stream id" },
      { status: 400 },
    );
  }
  const { streamId } = parsed.data;
  const stream = await getRecurringStream(session.user.id, streamId);
  if (!stream) {
    return NextResponse.json(
      { success: false, error: "Stream not found" },
      { status: 404 },
    );
  }

  const txns = await getStreamTransactions(session.user.id, streamId);

  return NextResponse.json({
    success: true,
    data: {
      stream,
      transactions: txns,
    },
  });
}
