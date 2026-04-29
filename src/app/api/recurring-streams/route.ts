import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { listRecurringStreams } from "@/lib/db/queries/recurring";

const QuerySchema = z.object({
  flow_type: z.enum(["inflow", "outflow"]).optional(),
  active_only: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
  include_tombstoned: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
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

  const streams = await listRecurringStreams(session.user.id, {
    flowType: parsed.data.flow_type,
    activeOnly: parsed.data.active_only,
    includeTombstoned: parsed.data.include_tombstoned,
  });

  return NextResponse.json({ success: true, data: streams });
}
