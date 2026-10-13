import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { DuplicateItemError, exchangePublicToken } from "@/lib/plaid/link";
import { DUPLICATE_ITEM_CODE, plaidErrorMessage } from "@/lib/plaid/types";
import { logError, plaidErrorCode } from "@/lib/logging";

// Link onSuccess metadata. Untrusted: only used for the pre-exchange duplicate
// check; the stored institution and accounts come from Plaid.
const ExchangeTokenSchema = z.object({
  publicToken: z.string().min(1, "Public token is required").max(512),
  metadata: z
    .object({
      institution: z
        .object({
          name: z.string().max(256),
          institutionId: z.string().max(128),
        })
        .nullable()
        .optional(),
      accounts: z
        .array(
          z.object({
            id: z.string().max(256),
            name: z.string().max(256),
            mask: z.string().max(32).nullable().optional(),
            type: z.string().max(64).optional(),
            subtype: z.string().max(64).nullable().optional(),
          }),
        )
        .max(200)
        .default([]),
    })
    .default({ accounts: [] }),
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
  const parsed = ExchangeTokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { publicToken, metadata } = parsed.data;

  try {
    const data = await exchangePublicToken(publicToken, session.user.id, {
      institution: metadata.institution?.institutionId
        ? metadata.institution
        : null,
      accounts: metadata.accounts.map((a) => ({ ...a, mask: a.mask ?? null })),
    });
    // The new Item carries a pending sync request (sync_requested_at); the
    // sync worker drains it. There is no inline sync any more: Plaid has no
    // transactions ready this early, so it only ever saved an empty cursor.
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof DuplicateItemError) {
      const bank = error.institutionName ?? "This bank";
      return NextResponse.json(
        {
          success: false,
          error: `${bank} is already connected. Reopening that connection so you can update it or add accounts.`,
          code: DUPLICATE_ITEM_CODE,
          existingPlaidItemId: error.existingPlaidItemId,
        },
        { status: 409 },
      );
    }
    logError("plaid-exchange.failed", error);
    return NextResponse.json(
      { success: false, error: plaidErrorMessage(plaidErrorCode(error)) },
      { status: 500 },
    );
  }
}
