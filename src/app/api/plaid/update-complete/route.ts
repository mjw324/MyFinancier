import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import {
  ItemNotHealthyError,
  PlaidItemNotFoundError,
  completeItemUpdate,
} from "@/lib/plaid/link";
import { ITEM_NOT_HEALTHY_CODE, plaidErrorMessage } from "@/lib/plaid/types";
import { describeError, logError, plaidErrorCode } from "@/lib/logging";
import { drainItemSoon } from "@/lib/plaid/jobs";

// Called by the client after Plaid Link update mode succeeds. The update-mode
// public_token is NOT exchanged: the access token does not change.
const UpdateCompleteSchema = z.object({
  plaidItemId: z.string().min(1).max(128),
  // True when the session had account selection enabled ("Add accounts").
  accountSelection: z.boolean().optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = UpdateCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { plaidItemId, accountSelection } = parsed.data;
  try {
    const data = await completeItemUpdate(session.user.id, plaidItemId, {
      accountSelection,
    });
    // Sync + recurring were requested inside the update transaction.
    drainItemSoon(plaidItemId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof PlaidItemNotFoundError) {
      return NextResponse.json(
        { success: false, error: "Connection not found" },
        { status: 404 },
      );
    }
    if (error instanceof ItemNotHealthyError) {
      logError("plaid-update.item-still-unhealthy", error, {
        plaidItemRowId: plaidItemId,
        plaidErrorCode: error.plaidErrorCode,
      });
      return NextResponse.json(
        {
          success: false,
          error: plaidErrorMessage(error.plaidErrorCode),
          code: ITEM_NOT_HEALTHY_CODE,
        },
        { status: 409 },
      );
    }
    logError("plaid-update.failed", error, { plaidItemRowId: plaidItemId });
    if (describeError(error).pgCode === "23505") {
      // Only possible while the legacy one-active-item-per-institution index
      // (plaid_items_user_institution_active_idx) still exists.
      return NextResponse.json(
        {
          success: false,
          error:
            "Another connection to this bank is already active. Unlink the duplicate connection, then try again.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { success: false, error: plaidErrorMessage(plaidErrorCode(error)) },
      { status: 500 },
    );
  }
}
