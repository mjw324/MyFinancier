import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { createLinkToken, createUpdateLinkToken } from "@/lib/plaid/link";
import { logError } from "@/lib/logging";

const RequestSchema = z
  .object({
    plaidItemId: z.string().optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 },
      );
    }

    const result = parsed.data?.plaidItemId
      ? await createUpdateLinkToken(session.user.id, parsed.data.plaidItemId)
      : await createLinkToken(session.user.id);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    logError("plaid-link-token.create-failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to create link token" },
      { status: 500 },
    );
  }
}
