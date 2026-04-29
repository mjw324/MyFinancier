import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/get-session";
import {
  getRecurringStream,
  getStreamTransactions,
} from "@/lib/db/queries/recurring";

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

  const { streamId } = await params;
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
