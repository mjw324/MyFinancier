import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const plaid = vi.hoisted(() => ({ webhookVerificationKeyGet: vi.fn() }));
vi.mock("@/lib/plaid/client", () => ({ plaidClient: plaid }));

import {
  resetWebhookKeyCache,
  testWebhookJwk,
  verifyPlaidWebhook,
  WebhookVerificationError,
} from "@/lib/plaid/webhook-verify";
import { shouldStartSweep } from "@/instrumentation";

const KID = "harness-test-kid";
let privateKey: CryptoKey;
let testJwk: string;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  testJwk = JSON.stringify({ ...(await exportJWK(pair.publicKey)), kid: KID, alg: "ES256" });
});

beforeEach(() => {
  resetWebhookKeyCache();
  plaid.webhookVerificationKeyGet.mockReset();
  // Plaid does not know the harness kid.
  plaid.webhookVerificationKeyGet.mockRejectedValue(
    Object.assign(new Error("Request failed with status code 400"), {
      response: { status: 400, data: { error_code: "INVALID_WEBHOOK_VERIFICATION_KEY_ID" } },
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function signed(body: string, opts: { iat?: number; hash?: string } = {}) {
  return new SignJWT({ request_body_sha256: opts.hash ?? createHash("sha256").update(body).digest("hex") })
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setIssuedAt(opts.iat ?? Math.floor(Date.now() / 1000))
    .sign(privateKey);
}

const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "x" });

describe("PLAID_WEBHOOK_TEST_JWK seam (harness only)", () => {
  it("is honoured in sandbox outside production builds — signature, iat and body hash still enforced", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PLAID_WEBHOOK_TEST_JWK", testJwk);

    await expect(verifyPlaidWebhook(body, await signed(body))).resolves.toBeUndefined();
    expect(plaid.webhookVerificationKeyGet).not.toHaveBeenCalled();

    await expect(verifyPlaidWebhook(body, await signed(body, { hash: "0".repeat(64) }))).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(
      verifyPlaidWebhook(body, await signed(body, { iat: Math.floor(Date.now() / 1000) - 3600 })),
    ).rejects.toMatchObject({ kind: "invalid" });
    // Flip a character in the middle of the signature: the last base64url
    // character of a 64-byte ES256 signature carries 4 padding bits, so
    // changing it can decode to identical bytes and still verify.
    const jwt = await signed(body);
    const sigStart = jwt.lastIndexOf(".") + 1;
    const mid = sigStart + 10;
    const tampered = jwt.slice(0, mid) + (jwt[mid] === "A" ? "B" : "A") + jwt.slice(mid + 1);
    await expect(verifyPlaidWebhook(body, tampered)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("is ignored when PLAID_ENV=production", async () => {
    vi.stubEnv("PLAID_ENV", "production");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PLAID_WEBHOOK_TEST_JWK", testJwk);
    expect(testWebhookJwk(KID)).toBeNull();
    await expect(verifyPlaidWebhook(body, await signed(body))).rejects.toMatchObject({ kind: "invalid" });
    expect(plaid.webhookVerificationKeyGet).toHaveBeenCalledTimes(1);
  });

  it("is ignored in a production build even against the sandbox", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAID_WEBHOOK_TEST_JWK", testJwk);
    expect(testWebhookJwk(KID)).toBeNull();
    await expect(verifyPlaidWebhook(body, await signed(body))).rejects.toMatchObject({ kind: "invalid" });
  });

  it("only matches its own kid", () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PLAID_WEBHOOK_TEST_JWK", testJwk);
    expect(testWebhookJwk(KID)).not.toBeNull();
    expect(testWebhookJwk("some-other-kid")).toBeNull();
  });
});

describe("instrumentation sweep gating", () => {
  it("starts only in the Node.js server runtime", () => {
    expect(shouldStartSweep({ NEXT_RUNTIME: "nodejs", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldStartSweep({ NEXT_RUNTIME: "edge", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    // The standalone production server (node server.js) leaves NEXT_RUNTIME unset at runtime.
    expect(shouldStartSweep({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(
      shouldStartSweep({ NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build", NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(shouldStartSweep({ NEXT_RUNTIME: "nodejs", VITEST: "true", NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldStartSweep({ NEXT_RUNTIME: "nodejs", PLAID_SYNC_SWEEP: "off", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    // Under this very test run:
    expect(shouldStartSweep()).toBe(false);
  });
});
