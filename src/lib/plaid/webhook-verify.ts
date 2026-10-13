import { createHash, timingSafeEqual } from "node:crypto";
import {
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
} from "jose";
import { plaidClient } from "./client";
import { describeError } from "@/lib/logging";

/**
 * Plaid webhook verification
 * (https://plaid.com/docs/api/webhooks/webhook-verification/).
 *
 * - `invalid`: the request is not a genuine Plaid webhook (bad header, alg,
 *   signature, iat, body hash, unknown or expired key). Answer 401: Plaid
 *   treats 4xx as permanent, which is right for forgeries.
 * - `unavailable`: we could not obtain the key (Plaid API error, timeout, or
 *   the unknown-kid budget is exhausted). Answer 503 so Plaid retries.
 */
export class WebhookVerificationError extends Error {
  constructor(
    readonly kind: "invalid" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

const MAX_IAT_SKEW_SECONDS = 5 * 60;
const KEY_REFRESH_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;
// Unknown-kid flood guard: at most this many key lookups per window for kids
// we have not cached. A real Plaid webhook that hits the limit gets a 503 and
// is redelivered.
const LOOKUP_WINDOW_MS = 60 * 1000;
const MAX_LOOKUPS_PER_WINDOW = 10;

type CachedKey = {
  jwk: JWK;
  /** Plaid's expired_at (unix seconds) or null while the key is current. */
  expiredAt: number | null;
  fetchedAt: number;
};

const keyCache = new Map<string, CachedKey>();
const unknownKids = new Map<string, number>();
let lookupWindowStart = 0;
let lookupsInWindow = 0;

/** Test hook: forget cached keys and counters. */
export function resetWebhookKeyCache(): void {
  keyCache.clear();
  unknownKids.clear();
  lookupWindowStart = 0;
  lookupsInWindow = 0;
}

/**
 * Local test seam (harness only): a public JWK supplied through
 * PLAID_WEBHOOK_TEST_JWK is accepted for its `kid`, but only when the app talks
 * to the Plaid sandbox and is not a production build. Signature, iat and body
 * hash checks still apply. `next start` sets NODE_ENV=production, so a deployed
 * server can never enable it.
 */
export function testWebhookJwk(kid: string): JWK | null {
  if (process.env.PLAID_ENV !== "sandbox") return null;
  if (process.env.NODE_ENV === "production") return null;
  const raw = process.env.PLAID_WEBHOOK_TEST_JWK;
  if (!raw) return null;
  try {
    const jwk = JSON.parse(raw) as JWK & { kid?: string };
    return jwk.kid === kid ? jwk : null;
  } catch {
    return null;
  }
}

function takeLookupBudget(now: number): boolean {
  if (now - lookupWindowStart > LOOKUP_WINDOW_MS) {
    lookupWindowStart = now;
    lookupsInWindow = 0;
  }
  if (lookupsInWindow >= MAX_LOOKUPS_PER_WINDOW) return false;
  lookupsInWindow++;
  return true;
}

async function fetchKey(kid: string, now: number): Promise<CachedKey | null> {
  let response;
  try {
    response = await plaidClient.webhookVerificationKeyGet({ key_id: kid });
  } catch (error) {
    const status = describeError(error).status;
    if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
      // Plaid does not know this kid: a forgery (or a stale key id).
      return null;
    }
    throw new WebhookVerificationError(
      "unavailable",
      `webhook key fetch failed (${status ?? "network"})`,
    );
  }
  const key = response.data.key;
  return {
    jwk: { kty: key.kty, crv: key.crv, x: key.x, y: key.y, alg: "ES256" },
    expiredAt: key.expired_at ?? null,
    fetchedAt: now,
  };
}

async function resolveKey(kid: string): Promise<JWK> {
  const testJwk = testWebhookJwk(kid);
  if (testJwk) return testJwk;

  const now = Date.now();
  const cached = keyCache.get(kid);
  if (cached && now - cached.fetchedAt < KEY_REFRESH_MS) {
    if (cached.expiredAt !== null) {
      throw new WebhookVerificationError("invalid", "webhook key expired");
    }
    return cached.jwk;
  }

  if (!cached) {
    const failedAt = unknownKids.get(kid);
    if (failedAt !== undefined && now - failedAt < NEGATIVE_CACHE_MS) {
      throw new WebhookVerificationError("invalid", "unknown webhook key id");
    }
    if (!takeLookupBudget(now)) {
      throw new WebhookVerificationError(
        "unavailable",
        "webhook key lookup budget exhausted",
      );
    }
  }

  let fresh: CachedKey | null;
  try {
    fresh = await fetchKey(kid, now);
  } catch (error) {
    // Refreshing a known key failed: keep using the cached copy.
    if (cached && cached.expiredAt === null) return cached.jwk;
    throw error;
  }
  if (!fresh) {
    keyCache.delete(kid);
    unknownKids.set(kid, now);
    if (unknownKids.size > 1000) unknownKids.clear();
    throw new WebhookVerificationError("invalid", "unknown webhook key id");
  }
  keyCache.set(kid, fresh);
  if (fresh.expiredAt !== null) {
    throw new WebhookVerificationError("invalid", "webhook key expired");
  }
  return fresh.jwk;
}

function sha256Hex(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

function hashMatches(rawBody: string, expectedHex: unknown): boolean {
  if (typeof expectedHex !== "string" || !/^[0-9a-f]{64}$/i.test(expectedHex)) {
    return false;
  }
  const actual = sha256Hex(rawBody);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function iatFresh(iat: unknown, nowSeconds: number): boolean {
  return (
    typeof iat === "number" &&
    Math.abs(nowSeconds - iat) <= MAX_IAT_SKEW_SECONDS
  );
}

/**
 * Verify the Plaid-Verification JWT against the raw request body. Cheap checks
 * (alg, kid, iat, body hash on the unverified claims) run before any key
 * lookup, so a malformed or stale request never costs a Plaid API call.
 */
export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string,
): Promise<void> {
  let header;
  let claims;
  try {
    header = decodeProtectedHeader(verificationHeader);
    claims = decodeJwt(verificationHeader);
  } catch {
    throw new WebhookVerificationError("invalid", "malformed JWT");
  }
  if (header.alg !== "ES256") {
    throw new WebhookVerificationError("invalid", "unexpected JWT algorithm");
  }
  if (typeof header.kid !== "string" || header.kid.length === 0 || header.kid.length > 128) {
    throw new WebhookVerificationError("invalid", "JWT header missing kid");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!iatFresh(claims.iat, nowSeconds)) {
    throw new WebhookVerificationError("invalid", "JWT iat outside window");
  }
  if (!hashMatches(rawBody, claims.request_body_sha256)) {
    throw new WebhookVerificationError("invalid", "body hash mismatch");
  }

  const jwk = await resolveKey(header.kid);

  let payload;
  try {
    const key = await importJWK(jwk, "ES256");
    ({ payload } = await jwtVerify(verificationHeader, key, {
      algorithms: ["ES256"],
    }));
  } catch {
    throw new WebhookVerificationError("invalid", "JWT signature invalid");
  }
  // Re-check on the verified payload.
  if (!iatFresh(payload.iat, nowSeconds)) {
    throw new WebhookVerificationError("invalid", "JWT iat outside window");
  }
  if (!hashMatches(rawBody, payload.request_body_sha256)) {
    throw new WebhookVerificationError("invalid", "body hash mismatch");
  }
}
