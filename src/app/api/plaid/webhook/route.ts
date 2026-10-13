import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { logError } from "@/lib/logging";
import { drainItemSoon, statusForPlaidErrorCode } from "@/lib/plaid/jobs";
import {
  verifyPlaidWebhook,
  WebhookVerificationError,
} from "@/lib/plaid/webhook-verify";

/**
 * Plaid webhook receiver.
 *
 * Plaid gives up on a delivery after 10 s and redelivers it with backoff (up
 * to 7 deliveries), so this handler only verifies the request, records what
 * needs doing with one UPDATE, schedules the background drain with `after()`,
 * and answers 200. All Plaid/API and heavy DB work happens in the drain
 * (src/lib/plaid/jobs.ts), serialised per item by a DB lease.
 *
 * Status codes: 401 = not a genuine Plaid webhook (permanent for Plaid);
 * 503 = verification key unavailable, 500 = our DB failed (Plaid retries);
 * 400 = malformed body; 200 otherwise (including ignored/unknown webhooks).
 */

const MAX_BODY_BYTES = 64 * 1024;

const Envelope = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string().min(1).max(200).optional(),
  environment: z.string().optional(),
});

const SyncUpdatesAvailable = z.object({
  item_id: z.string(),
  initial_update_complete: z.boolean().optional(),
  historical_update_complete: z.boolean().optional(),
});

const ItemError = z.object({
  item_id: z.string(),
  error: z
    .object({ error_code: z.string().optional(), error_type: z.string().optional() })
    .nullish(),
});

const PendingConsent = z.object({
  item_id: z.string(),
  consent_expiration_time: z.string().nullish(),
});

const UserAccountRevoked = z.object({
  item_id: z.string(),
  account_id: z.string().nullish(),
});

// Legacy transactions webhooks that accompany SYNC_UPDATES_AVAILABLE for items
// created before /transactions/sync. Nothing to do.
const LEGACY_TRANSACTION_CODES = new Set([
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
  "TRANSACTIONS_REMOVED",
]);

type Handled = { itemRowId: string | null; action: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const startedAt = performance.now();

  const verification = request.headers.get("plaid-verification");
  if (!verification) {
    return json(401, { success: false, error: "Missing Plaid-Verification header" });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return json(413, { success: false, error: "Payload too large" });
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json(413, { success: false, error: "Payload too large" });
  }

  try {
    await verifyPlaidWebhook(rawBody, verification);
  } catch (error) {
    if (error instanceof WebhookVerificationError && error.kind === "invalid") {
      console.warn(`[plaid-webhook] rejected: ${error.message}`);
      return json(401, { success: false, error: "Webhook verification failed" });
    }
    logError("plaid-webhook.verification-unavailable", error);
    return json(503, { success: false, error: "Verification temporarily unavailable" });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { success: false, error: "Invalid JSON" });
  }
  const envelope = Envelope.safeParse(body);
  if (!envelope.success) {
    return json(400, { success: false, error: "Invalid webhook payload" });
  }

  let handled: Handled;
  try {
    handled = await handleWebhook(envelope.data, body);
  } catch (error) {
    // Our database failed: let Plaid redeliver.
    logError("plaid-webhook.processing-failed", error, {
      webhookType: envelope.data.webhook_type,
      webhookCode: envelope.data.webhook_code,
    });
    return json(500, { success: false, error: "Internal server error" });
  }

  if (handled.itemRowId && handled.action === "drain") {
    drainItemSoon(handled.itemRowId);
  }

  console.log(
    `[plaid-webhook] ${JSON.stringify({
      type: envelope.data.webhook_type,
      code: envelope.data.webhook_code,
      item: shortId(envelope.data.item_id),
      env: envelope.data.environment ?? null,
      action: handled.action,
      ms: Math.round(performance.now() - startedAt),
    })}`,
  );
  return json(200, { success: true, data: { received: true } });
}

function shortId(id: string | undefined): string | null {
  return id ? `${id.slice(0, 6)}…` : null;
}

/**
 * Apply a verified webhook: at most one or two short statements, never a
 * Plaid call. Returns the item row to drain, if any.
 */
async function handleWebhook(
  envelope: z.infer<typeof Envelope>,
  body: unknown,
): Promise<Handled> {
  const { webhook_type: type, webhook_code: code, item_id: itemId } = envelope;
  if (!itemId) return { itemRowId: null, action: "ignored" };

  if (type === "TRANSACTIONS") {
    if (code === "SYNC_UPDATES_AVAILABLE") {
      const parsed = SyncUpdatesAvailable.safeParse(body);
      const historical = parsed.success && parsed.data.historical_update_complete === true;
      const id = await stampItem(itemId, {
        syncRequestedAt: sql`now()`,
        ...(historical
          ? {
              historicalUpdateCompleteAt: sql`COALESCE(${plaidItems.historicalUpdateCompleteAt}, now())`,
            }
          : {}),
      });
      return { itemRowId: id, action: id ? "drain" : "unknown-item" };
    }
    if (code === "RECURRING_TRANSACTIONS_UPDATE") {
      const id = await stampItem(itemId, {
        syncRequestedAt: sql`now()`,
        recurringRequestedAt: sql`now()`,
      });
      return { itemRowId: id, action: id ? "drain" : "unknown-item" };
    }
    if (LEGACY_TRANSACTION_CODES.has(code)) {
      return { itemRowId: null, action: "ignored" };
    }
    return { itemRowId: null, action: "unhandled" };
  }

  if (type === "ITEM") {
    switch (code) {
      case "ERROR": {
        const parsed = ItemError.safeParse(body);
        const errorCode = parsed.success ? parsed.data.error?.error_code : undefined;
        const status = statusForPlaidErrorCode(errorCode);
        const id = await stampItem(itemId, {
          lastSyncErrorCode: errorCode ?? "ITEM_ERROR",
          ...(status ? { status } : {}),
          ...(status === "login_required" ? { attention: "login_required" } : {}),
        });
        return { itemRowId: id, action: status ?? "error-recorded" };
      }
      case "LOGIN_REPAIRED": {
        // The item healed on its own: silence the reconnect prompt and sync.
        const id = await stampItem(itemId, {
          status: sql`CASE WHEN ${plaidItems.status} = 'login_required' THEN 'active' ELSE ${plaidItems.status} END`,
          attention: sql`CASE WHEN ${plaidItems.attention} = 'login_required' THEN NULL ELSE ${plaidItems.attention} END`,
          lastSyncErrorCode: null,
          syncRequestedAt: sql`now()`,
        });
        return { itemRowId: id, action: id ? "drain" : "unknown-item" };
      }
      case "PENDING_DISCONNECT": // US/CA: ~7 days before the item disconnects
      case "PENDING_EXPIRATION": {
        // UK/EU consent expiry. Never blocks sync; the user is prompted to
        // re-consent through update mode.
        const parsed = PendingConsent.safeParse(body);
        const expires = parsed.success ? parsed.data.consent_expiration_time : null;
        const expiresAt = expires && !Number.isNaN(Date.parse(expires)) ? new Date(expires) : null;
        const id = await stampItem(itemId, {
          attention: code === "PENDING_DISCONNECT" ? "pending_disconnect" : "pending_expiration",
          consentExpiresAt: expiresAt ?? sql`now() + interval '7 days'`,
        });
        return { itemRowId: id, action: "attention" };
      }
      case "NEW_ACCOUNTS_AVAILABLE": {
        const id = await stampItem(itemId, { attention: "new_accounts_available" });
        return { itemRowId: id, action: "attention" };
      }
      case "USER_PERMISSION_REVOKED": {
        const id = await stampItem(itemId, {
          status: "revoked",
          attention: null,
          lastSyncErrorCode: "USER_PERMISSION_REVOKED",
        });
        return { itemRowId: id, action: "revoked" };
      }
      case "USER_ACCOUNT_REVOKED": {
        // Account-level revocation (Plaid: the item keeps working for its
        // other accounts). Close that account; without an account id, treat
        // the whole item as revoked.
        const parsed = UserAccountRevoked.safeParse(body);
        const accountId = parsed.success ? parsed.data.account_id : null;
        if (!accountId) {
          const id = await stampItem(itemId, {
            status: "revoked",
            lastSyncErrorCode: "USER_ACCOUNT_REVOKED",
          });
          return { itemRowId: id, action: "revoked" };
        }
        const closed = await db
          .update(financialAccounts)
          .set({ closedAt: sql`now()` })
          .where(
            and(
              eq(financialAccounts.plaidAccountId, accountId),
              isNull(financialAccounts.closedAt),
              sql`${financialAccounts.plaidItemId} = (SELECT id FROM ${plaidItems} WHERE item_id = ${itemId})`,
            ),
          )
          .returning({ id: financialAccounts.plaidItemId });
        return { itemRowId: closed[0]?.id ?? null, action: "account-closed" };
      }
      case "WEBHOOK_UPDATE_ACKNOWLEDGED":
        return { itemRowId: null, action: "ignored" };
      default:
        return { itemRowId: null, action: "unhandled" };
    }
  }

  return { itemRowId: null, action: "unhandled" };
}

/** One UPDATE by Plaid item_id; returns the row id, or null for an unknown item. */
async function stampItem(
  plaidItemId: string,
  set: Partial<Record<keyof typeof plaidItems.$inferInsert, unknown>>,
): Promise<string | null> {
  const rows = await db
    .update(plaidItems)
    .set(set as Partial<typeof plaidItems.$inferInsert>)
    .where(eq(plaidItems.itemId, plaidItemId))
    .returning({ id: plaidItems.id });
  return rows[0]?.id ?? null;
}
