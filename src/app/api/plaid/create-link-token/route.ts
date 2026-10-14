import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import {
  PlaidItemNotFoundError,
  createLinkToken,
  createUpdateLinkToken,
} from "@/lib/plaid/link";
import { plaidErrorMessage } from "@/lib/plaid/types";
import { logError, plaidErrorCode } from "@/lib/logging";

const RequestSchema = z
  .object({
    // Update mode on one of the user's Items (reconnect / renew / add accounts).
    plaidItemId: z.string().min(1).max(128).optional(),
    // Update mode with account selection, to share additional accounts.
    accountSelection: z.boolean().optional(),
  })
  .refine((b) => !b.accountSelection || b.plaidItemId, {
    message: "accountSelection requires plaidItemId",
  });

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { plaidItemId, accountSelection } = parsed.data;
  try {
    const result = plaidItemId
      ? await createUpdateLinkToken(session.user.id, plaidItemId, {
          accountSelection,
        })
      : await createLinkToken(session.user.id);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof PlaidItemNotFoundError) {
      return NextResponse.json(
        { success: false, error: "Connection not found" },
        { status: 404 },
      );
    }
    logError("plaid-link-token.create-failed", error, {
      plaidItemRowId: plaidItemId,
      updateMode: Boolean(plaidItemId),
    });
    const code = plaidErrorCode(error);
    return NextResponse.json(
      {
        success: false,
        error: code
          ? plaidErrorMessage(code)
          : "Failed to start the bank connection. Please try again.",
      },
      { status: 500 },
    );
  }
}
