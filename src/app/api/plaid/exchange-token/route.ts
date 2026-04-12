import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { exchangePublicToken } from "@/lib/plaid/link";
import { syncTransactions } from "@/lib/plaid/sync";
import { PLAID_ERROR_MESSAGES } from "@/lib/plaid/types";

const ExchangeTokenSchema = z.object({
  publicToken: z.string().min(1, "Public token is required"),
  metadata: z.object({
    institution: z.object({
      name: z.string(),
      institutionId: z.string(),
    }),
    accounts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        mask: z.string().nullable(),
        type: z.string(),
        subtype: z.string().nullable(),
      }),
    ),
  }),
});

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const parsed = ExchangeTokenSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 },
      );
    }

    const { publicToken, metadata } = parsed.data;

    const exchangeResult = await exchangePublicToken(
      publicToken,
      session.user.id,
      metadata,
    );

    // Trigger initial sync non-blocking
    const newItem = await db.query.plaidItems.findFirst({
      where: eq(plaidItems.itemId, exchangeResult.itemId),
    });

    if (newItem) {
      syncTransactions(newItem.id).catch((error) => {
        console.error(`Initial sync failed for item ${newItem.id}:`, error);
      });
    }

    return NextResponse.json({ success: true, data: exchangeResult });
  } catch (error) {
    console.error("Error exchanging token:", error);
    return NextResponse.json(
      { success: false, error: mapPlaidErrorMessage(error) },
      { status: 500 },
    );
  }
}

function mapPlaidErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error
  ) {
    const resp = (error as { response?: { data?: { error_code?: string } } })
      .response;
    const code = resp?.data?.error_code;
    if (code && code in PLAID_ERROR_MESSAGES) {
      return PLAID_ERROR_MESSAGES[code];
    }
  }
  return PLAID_ERROR_MESSAGES.DEFAULT;
}
