import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeUser } from "../setup/factories";
import { plaidApiError } from "../setup/plaid-fixtures";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";

const plaid = vi.hoisted(() => ({
  webhookVerificationKeyGet: vi.fn(),
  transactionsSync: vi.fn(),
  transactionsRecurringGet: vi.fn(),
}));
vi.mock("@/lib/plaid/client", () => ({ plaidClient: plaid }));
const drainItemSoon = vi.hoisted(() => vi.fn());
vi.mock("@/lib/plaid/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plaid/jobs")>()),
  drainItemSoon,
}));

import { POST } from "@/app/api/plaid/webhook/route";
import { resetWebhookKeyCache } from "@/lib/plaid/webhook-verify";

const U = "u_hook";
const ITEM_ROW = "pi_hook";
const PLAID_ITEM = "plaid_item_hook";
const KID = "kid-hook-1";

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  publicJwk = await exportJWK(pair.publicKey);
});

async function sign(
  rawBody: string,
  opts: { kid?: string; iat?: number; hash?: string; key?: CryptoKey } = {},
) {
  return new SignJWT({
    request_body_sha256: opts.hash ?? createHash("sha256").update(rawBody).digest("hex"),
  })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? KID, typ: "JWT" })
    .setIssuedAt(opts.iat ?? Math.floor(Date.now() / 1000))
    .sign(opts.key ?? privateKey);
}

async function deliver(body: object, opts: Parameters<typeof sign>[1] & { header?: string | null } = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const header = opts.header === undefined ? await sign(raw, opts) : opts.header;
  if (header) headers["plaid-verification"] = header;
  const started = performance.now();
  const res = await POST(new Request("http://localhost/api/plaid/webhook", { method: "POST", headers, body: raw }));
  return { status: res.status, json: await res.json(), ms: performance.now() - started };
}

function keyResponse(over: Partial<{ expired_at: number | null }> = {}) {
  return {
    data: {
      key: { ...publicJwk, kid: KID, alg: "ES256", use: "sig", created_at: 1, expired_at: null, ...over },
    },
  };
}

async function item() {
  const [row] = await getTestDb().select().from(plaidItems).where(eq(plaidItems.id, ITEM_ROW));
  return row;
}

const syncBody = (over: object = {}) => ({
  webhook_type: "TRANSACTIONS",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  item_id: PLAID_ITEM,
  environment: "sandbox",
  initial_update_complete: true,
  historical_update_complete: false,
  ...over,
});

beforeEach(async () => {
  resetWebhookKeyCache();
  for (const fn of Object.values(plaid)) fn.mockReset();
  drainItemSoon.mockReset();
  plaid.webhookVerificationKeyGet.mockResolvedValue(keyResponse());
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: U }));
  await db.insert(plaidItems).values(makePlaidItem({ id: ITEM_ROW, userId: U, itemId: PLAID_ITEM }));
});

describe("webhook verification (verify-plaid N5)", () => {
  it("401 without the Plaid-Verification header", async () => {
    expect((await deliver(syncBody(), { header: null })).status).toBe(401);
  });

  it("401 for a bad signature, stale iat, or body-hash mismatch — stale/hash failures cost no key lookup", async () => {
    const other = await generateKeyPair("ES256");
    expect((await deliver(syncBody(), { key: other.privateKey as CryptoKey })).status).toBe(401);
    expect(plaid.webhookVerificationKeyGet).toHaveBeenCalledTimes(1);

    plaid.webhookVerificationKeyGet.mockClear();
    resetWebhookKeyCache();
    expect((await deliver(syncBody(), { iat: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    expect((await deliver(syncBody(), { hash: "0".repeat(64) })).status).toBe(401);
    expect(plaid.webhookVerificationKeyGet).not.toHaveBeenCalled();
    expect((await item()).syncRequestedAt).toBeNull();
  });

  it("401 for a non-ES256 token", async () => {
    const raw = JSON.stringify(syncBody());
    const hs = await new SignJWT({ request_body_sha256: createHash("sha256").update(raw).digest("hex") })
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .setIssuedAt()
      .sign(new TextEncoder().encode("x".repeat(32)));
    expect((await deliver(syncBody(), { header: hs })).status).toBe(401);
  });

  it("503 (Plaid retries) when the key endpoint fails, 401 when Plaid does not know the kid", async () => {
    plaid.webhookVerificationKeyGet.mockRejectedValueOnce(plaidApiError("INTERNAL_SERVER_ERROR", 500, "API_ERROR"));
    expect((await deliver(syncBody())).status).toBe(503);

    plaid.webhookVerificationKeyGet.mockRejectedValueOnce(plaidApiError("INVALID_WEBHOOK_VERIFICATION_KEY_ID", 400, "INVALID_INPUT"));
    expect((await deliver(syncBody(), { kid: "kid-forged" })).status).toBe(401);
    // The unknown kid is negatively cached: no second lookup.
    expect((await deliver(syncBody(), { kid: "kid-forged" })).status).toBe(401);
    expect(plaid.webhookVerificationKeyGet).toHaveBeenCalledTimes(2);
  });

  it("caches keys by kid and rejects an expired key", async () => {
    expect((await deliver(syncBody())).status).toBe(200);
    expect((await deliver(syncBody())).status).toBe(200);
    expect(plaid.webhookVerificationKeyGet).toHaveBeenCalledTimes(1);

    resetWebhookKeyCache();
    plaid.webhookVerificationKeyGet.mockResolvedValue(keyResponse({ expired_at: 1_700_000_000 }));
    expect((await deliver(syncBody())).status).toBe(401);
  });

  it("limits key lookups for unknown kids (flood guard → 503, Plaid would retry)", async () => {
    plaid.webhookVerificationKeyGet.mockRejectedValue(plaidApiError("INVALID_WEBHOOK_VERIFICATION_KEY_ID", 400, "INVALID_INPUT"));
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await deliver(syncBody(), { kid: `flood-${i}` })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([503, 503]);
    expect(plaid.webhookVerificationKeyGet).toHaveBeenCalledTimes(10);
  });
});

describe("webhook handling: fast acknowledgement (audit 2.1)", () => {
  it("SYNC_UPDATES_AVAILABLE stamps a request, schedules the drain and answers 200 without any sync work", async () => {
    const res = await deliver(syncBody());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, data: { received: true } });
    expect(res.ms).toBeLessThan(1000);
    expect(plaid.transactionsSync).not.toHaveBeenCalled();
    expect(plaid.transactionsRecurringGet).not.toHaveBeenCalled();
    expect(drainItemSoon).toHaveBeenCalledWith(ITEM_ROW);
    const row = await item();
    expect(row.syncRequestedAt).toBeInstanceOf(Date);
    expect(row.recurringRequestedAt).toBeNull();
    expect(row.historicalUpdateCompleteAt).toBeNull();
  });

  it("stamps historical_update_complete_at only on the false→true transition", async () => {
    await deliver(syncBody({ historical_update_complete: true }));
    const first = (await item()).historicalUpdateCompleteAt;
    expect(first).toBeInstanceOf(Date);
    await new Promise((r) => setTimeout(r, 20));
    await deliver(syncBody({ historical_update_complete: true }));
    expect((await item()).historicalUpdateCompleteAt?.getTime()).toBe(first!.getTime());
  });

  it("RECURRING_TRANSACTIONS_UPDATE requests a recurring refresh", async () => {
    const res = await deliver({ webhook_type: "TRANSACTIONS", webhook_code: "RECURRING_TRANSACTIONS_UPDATE", item_id: PLAID_ITEM, account_ids: [] });
    expect(res.status).toBe(200);
    const row = await item();
    expect(row.recurringRequestedAt).toBeInstanceOf(Date);
    expect(drainItemSoon).toHaveBeenCalledWith(ITEM_ROW);
  });

  it("ignores legacy transaction codes and unknown items quietly (200, nothing scheduled)", async () => {
    for (const code of ["DEFAULT_UPDATE", "TRANSACTIONS_REMOVED", "INITIAL_UPDATE", "HISTORICAL_UPDATE"]) {
      expect((await deliver({ webhook_type: "TRANSACTIONS", webhook_code: code, item_id: PLAID_ITEM })).status).toBe(200);
    }
    expect((await deliver(syncBody({ item_id: "unknown_item" }))).status).toBe(200);
    expect(drainItemSoon).not.toHaveBeenCalled();
    expect((await item()).syncRequestedAt).toBeNull();
  });

  it("400 for a verified but malformed body", async () => {
    expect((await deliver({ hello: "world" })).status).toBe(400);
  });
});

describe("item webhooks → status transitions (audit 2.6, verify-plaid N6)", () => {
  const itemHook = (code: string, extra: object = {}) => ({ webhook_type: "ITEM", webhook_code: code, item_id: PLAID_ITEM, ...extra });

  it("ERROR / ITEM_LOGIN_REQUIRED → login_required + attention; LOGIN_REPAIRED → active, attention cleared, sync requested", async () => {
    await deliver(itemHook("ERROR", { error: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "x", display_message: null } }));
    expect(await item()).toMatchObject({ status: "login_required", attention: "login_required", lastSyncErrorCode: "ITEM_LOGIN_REQUIRED" });
    expect(drainItemSoon).not.toHaveBeenCalled();

    await deliver(itemHook("LOGIN_REPAIRED"));
    const row = await item();
    expect(row).toMatchObject({ status: "active", attention: null, lastSyncErrorCode: null });
    expect(row.syncRequestedAt).toBeInstanceOf(Date);
    expect(drainItemSoon).toHaveBeenCalledWith(ITEM_ROW);
  });

  it("PENDING_DISCONNECT (US) and PENDING_EXPIRATION (EU) set attention + consent expiry but never block sync", async () => {
    await deliver(itemHook("PENDING_DISCONNECT", { reason: "INSTITUTION_TOKEN_EXPIRATION" }));
    let row = await item();
    expect(row).toMatchObject({ status: "active", attention: "pending_disconnect" });
    expect(row.consentExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 864e5);

    await deliver(itemHook("PENDING_EXPIRATION", { consent_expiration_time: "2027-04-20T20:32:50Z" }));
    row = await item();
    expect(row).toMatchObject({ status: "active", attention: "pending_expiration" });
    expect(row.consentExpiresAt?.toISOString()).toBe("2027-04-20T20:32:50.000Z");
  });

  it("NEW_ACCOUNTS_AVAILABLE → attention", async () => {
    await deliver(itemHook("NEW_ACCOUNTS_AVAILABLE"));
    expect(await item()).toMatchObject({ status: "active", attention: "new_accounts_available" });
  });

  it("USER_PERMISSION_REVOKED → revoked", async () => {
    await deliver(itemHook("USER_PERMISSION_REVOKED"));
    expect((await item()).status).toBe("revoked");
  });

  it("USER_ACCOUNT_REVOKED closes that account (item keeps syncing); without account_id the item is revoked", async () => {
    await getTestDb().insert(financialAccounts).values([
      makeAccount({ id: "acc_a", userId: U, plaidItemId: ITEM_ROW, plaidAccountId: "pa_a" }),
      makeAccount({ id: "acc_b", userId: U, plaidItemId: ITEM_ROW, plaidAccountId: "pa_b" }),
    ]);
    await deliver(itemHook("USER_ACCOUNT_REVOKED", { account_id: "pa_a" }));
    const rows = await getTestDb().select().from(financialAccounts).where(eq(financialAccounts.plaidItemId, ITEM_ROW));
    expect(rows.find((r) => r.id === "acc_a")?.closedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.id === "acc_b")?.closedAt).toBeNull();
    expect((await item()).status).toBe("active");

    await deliver(itemHook("USER_ACCOUNT_REVOKED"));
    expect((await item()).status).toBe("revoked");
  });

  it("WEBHOOK_UPDATE_ACKNOWLEDGED is ignored", async () => {
    expect((await deliver(itemHook("WEBHOOK_UPDATE_ACKNOWLEDGED"))).status).toBe(200);
    expect(await item()).toMatchObject({ status: "active", attention: null });
  });
});
