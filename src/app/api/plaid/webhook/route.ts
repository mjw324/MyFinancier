import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { plaidClient } from "@/lib/plaid/client";
import { syncTransactions } from "@/lib/plaid/sync";

// --- Webhook Verification ---

async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string,
): Promise<void> {
  // Step 1-2: Decode JWT header, verify algorithm and extract kid
  const header = decodeProtectedHeader(verificationHeader);
  if (header.alg !== "ES256") {
    throw new Error(`Unexpected JWT algorithm: ${header.alg}`);
  }
  if (!header.kid) {
    throw new Error("JWT header missing kid");
  }

  // Step 3: Fetch public key from Plaid
  const keyResponse = await plaidClient.webhookVerificationKeyGet({
    key_id: header.kid,
  });
  const jwk = keyResponse.data.key;

  // Step 4: Import JWK and verify JWT signature
  const publicKey = await importJWK(
    {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
    },
    "ES256",
  );
  const { payload } = await jwtVerify(verificationHeader, publicKey, {
    algorithms: ["ES256"],
  });

  // Step 5: Check iat is within 5 minutes
  const iat = payload.iat;
  if (!iat) {
    throw new Error("JWT payload missing iat");
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - iat) > 5 * 60) {
    throw new Error("JWT iat is outside 5-minute window");
  }

  // Step 6: Verify body hash with constant-time comparison
  const expectedHash = payload.request_body_sha256 as string | undefined;
  if (!expectedHash) {
    throw new Error("JWT payload missing request_body_sha256");
  }
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");

  const bodyHashBuffer = Buffer.from(bodyHash, "hex");
  const expectedHashBuffer = Buffer.from(expectedHash, "hex");
  if (
    bodyHashBuffer.length !== expectedHashBuffer.length ||
    !timingSafeEqual(bodyHashBuffer, expectedHashBuffer)
  ) {
    throw new Error("Body hash verification failed");
  }
}

// --- Webhook Payload Schemas ---

const TransactionWebhookSchema = z.object({
  webhook_type: z.literal("TRANSACTIONS"),
  webhook_code: z.literal("SYNC_UPDATES_AVAILABLE"),
  item_id: z.string(),
  initial_update_complete: z.boolean().optional(),
  historical_update_complete: z.boolean().optional(),
});

const ItemErrorWebhookSchema = z.object({
  webhook_type: z.literal("ITEM"),
  webhook_code: z.literal("ERROR"),
  item_id: z.string(),
  error: z
    .object({
      error_type: z.string(),
      error_code: z.string(),
      error_message: z.string(),
      display_message: z.string().nullable(),
    })
    .nullable(),
});

const ItemPendingExpirationSchema = z.object({
  webhook_type: z.literal("ITEM"),
  webhook_code: z.literal("PENDING_EXPIRATION"),
  item_id: z.string(),
  consent_expiration_time: z.string(),
});

// --- Route Handler ---

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    const verificationHeader = request.headers.get("Plaid-Verification");
    if (!verificationHeader) {
      return NextResponse.json(
        { success: false, error: "Missing Plaid-Verification header" },
        { status: 401 },
      );
    }

    try {
      await verifyPlaidWebhook(rawBody, verificationHeader);
    } catch (verifyError) {
      console.error("Webhook verification failed:", verifyError);
      return NextResponse.json(
        { success: false, error: "Webhook verification failed" },
        { status: 401 },
      );
    }

    const body = JSON.parse(rawBody);
    const webhookType = body.webhook_type as string;
    const webhookCode = body.webhook_code as string;

    if (
      webhookType === "TRANSACTIONS" &&
      webhookCode === "SYNC_UPDATES_AVAILABLE"
    ) {
      await handleSyncUpdatesAvailable(body);
    } else if (webhookType === "ITEM" && webhookCode === "ERROR") {
      await handleItemError(body);
    } else if (
      webhookType === "ITEM" &&
      webhookCode === "PENDING_EXPIRATION"
    ) {
      await handlePendingExpiration(body);
    } else {
      console.log(`Unhandled webhook: ${webhookType}/${webhookCode}`);
    }

    return NextResponse.json({ success: true, data: { received: true } });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// --- Webhook Handlers ---

async function handleSyncUpdatesAvailable(body: unknown) {
  const parsed = TransactionWebhookSchema.parse(body);

  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.itemId, parsed.item_id),
  });

  if (!item) {
    console.error(
      `Webhook: plaid item not found for item_id ${parsed.item_id}`,
    );
    return;
  }

  try {
    await syncTransactions(item.id);
  } catch (error) {
    console.error(`Webhook sync failed for item ${item.id}:`, error);
  }
}

async function handleItemError(body: unknown) {
  const parsed = ItemErrorWebhookSchema.parse(body);

  if (parsed.error?.error_code === "ITEM_LOGIN_REQUIRED") {
    await db
      .update(plaidItems)
      .set({ status: "login_required", updatedAt: new Date() })
      .where(eq(plaidItems.itemId, parsed.item_id));
  } else {
    console.error(
      `Item error webhook: ${parsed.error?.error_code} for item ${parsed.item_id}`,
    );
  }
}

async function handlePendingExpiration(body: unknown) {
  const parsed = ItemPendingExpirationSchema.parse(body);

  await db
    .update(plaidItems)
    .set({ status: "pending_expiration", updatedAt: new Date() })
    .where(eq(plaidItems.itemId, parsed.item_id));
}
