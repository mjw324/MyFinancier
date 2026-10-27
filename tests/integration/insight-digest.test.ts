/**
 * Weekly digest job end to end against PGlite, with the AI SDK's mock model
 * (never a real API) and the email sender mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { MockLanguageModelV4 } from "ai/test";
import { getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeUser } from "../setup/factories";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { insightCandidates } from "@/lib/db/schema/insights";
import { aiUsage } from "@/lib/db/schema/ai";

const sent = vi.hoisted(() => [] as Array<{ to: string; subject: string; html: string }>);
vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(async (opts: { to: string; subject: string; html: string }) => void sent.push(opts)),
}));

import { runDigest, setCandidateFeedback } from "@/lib/insights/jobs";
import { getLatestDigest } from "@/lib/insights/candidates";

const U = "u_digest";
const PAST = new Date("2020-01-01T00:00:00Z");

function mockModel(elements: unknown[] | ((prompt: string) => unknown[])) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      prompts.push(prompt);
      const out = typeof elements === "function" ? elements(prompt) : elements;
      return {
        content: [{ type: "text", text: JSON.stringify({ elements: out }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1_000, noCache: 1_000, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 200, text: 200, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

async function seed({ optIn = true, priceIncrease = true } = {}) {
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: U, name: "Alex Rivera", email: "alex@example.test" }));
  await db.insert(plaidItems).values(makePlaidItem({ id: "pi_d", userId: U, accessToken: "enc:SECRET_TOKEN" }));
  await db.insert(financialAccounts).values(makeAccount({ id: "acct_d", userId: U, plaidItemId: "pi_d", mask: "4402" }));
  await db.insert(recurringStreams).values({
    streamId: "s_netflix",
    userId: U,
    plaidItemId: "pi_d",
    accountId: "acct_d",
    flowType: "outflow",
    description: "NETFLIX.COM",
    merchantName: "Netflix",
    frequency: "MONTHLY",
    status: "MATURE",
    isActive: true,
    firstDate: new Date("2024-01-09T00:00:00Z"),
    lastDate: new Date("2026-10-09T00:00:00Z"),
    predictedNextDate: new Date("2099-01-09T00:00:00Z"),
    averageAmount: "17.99",
    lastAmount: priceIncrease ? "22.99" : "17.99",
  });
  await db.insert(userPreferences).values({ userId: U, aiOptIn: optIn, aiConsentAt: PAST, aiConsentVersion: "v1", digestDueAt: PAST });
}

const prefs = async () => (await getTestDb().select().from(userPreferences).where(eq(userPreferences.userId, U)))[0];

beforeEach(() => {
  vi.stubEnv("AI_ENABLED", "true");
  sent.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("runDigest", () => {
  it("does nothing while AI_ENABLED is off", async () => {
    vi.stubEnv("AI_ENABLED", "");
    await seed();
    const { model, prompts } = mockModel([]);
    expect(await runDigest(U, { model })).toEqual({ status: "disabled" });
    expect(prompts).toHaveLength(0);
  });

  it("skips users who have not opted in", async () => {
    await seed({ optIn: false });
    const { model, prompts } = mockModel([]);
    expect(await runDigest(U, { model })).toEqual({ status: "skipped" });
    expect(prompts).toHaveLength(0);
  });

  it("ranks, fills figures from the payload, stores, emails and reschedules", async () => {
    await seed();
    const { model, prompts } = mockModel([
      { candidateId: "c1", title: "{{merchant}} costs more now", body: "It went from {{oldAmount}} to {{newAmount}}. Check whether the plan still suits you." },
    ]);
    const res = await runDigest(U, { model });
    expect(res).toEqual({ status: "sent", items: 1, emailed: true });

    // The model saw aggregates only: no ids, tokens, masks, name or email.
    expect(prompts).toHaveLength(1);
    for (const secret of ["SECRET_TOKEN", "4402", "Alex", "alex@example.test", "s_netflix", "acct_d", U]) {
      expect(prompts[0]).not.toContain(secret);
    }

    const [item] = await getLatestDigest(U);
    expect(item.type).toBe("price_increase");
    expect(item.title).toBe("Netflix costs more now");
    expect(item.body).toBe("It went from $17.99 to $22.99. Check whether the plan still suits you.");
    expect(item.shownAt).not.toBeNull();

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("alex@example.test");
    expect(sent[0].html).toContain("$22.99");

    const usage = await getTestDb().select().from(aiUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ feature: "digest", inputTokens: 1_000, outputTokens: 200 });

    const p = await prefs();
    expect(p.digestLeaseUntil).toBeNull();
    expect(p.lastDigestAt).not.toBeNull();
    expect(p.digestDueAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    // Not due again until next week.
    expect(await runDigest(U, { model })).toEqual({ status: "skipped" });
  });

  it("makes no model call when nothing clears the threshold", async () => {
    await seed({ priceIncrease: false });
    const { model, prompts } = mockModel([]);
    expect(await runDigest(U, { model })).toEqual({ status: "nothing" });
    expect(prompts).toHaveLength(0);
    expect((await prefs()).digestDueAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("falls back to the template when the model types a figure", async () => {
    await seed();
    const { model } = mockModel([{ candidateId: "c1", title: "Netflix up", body: "Netflix now costs $24.99 a month." }]);
    await runDigest(U, { model });
    const [item] = await getLatestDigest(U);
    expect(item.body).toBe("Netflix charged $22.99 last time, up $5.00 from its usual $17.99.");
  });

  it("does not call the model for a user over the monthly budget", async () => {
    await seed();
    await getTestDb().insert(aiUsage).values({ userId: U, feature: "digest", model: "m", costMicros: 50_000_000 });
    const { model, prompts } = mockModel([]);
    expect(await runDigest(U, { model })).toEqual({ status: "over_budget" });
    expect(prompts).toHaveLength(0);
  });

  it("lets only one of two concurrent runs claim the lease", async () => {
    await seed();
    const { model, prompts } = mockModel([{ candidateId: "c1", title: "{{merchant}} went up", body: "Now {{newAmount}}." }]);
    const results = await Promise.all([runDigest(U, { model }), runDigest(U, { model })]);
    expect(results.map((r) => r.status).sort()).toEqual(["sent", "skipped"]);
    expect(prompts).toHaveLength(1);
  });

  it("records dismiss and helpful only on the user's own candidates", async () => {
    await seed();
    const { model } = mockModel([{ candidateId: "c1", title: "{{merchant}} went up", body: "Now {{newAmount}}." }]);
    await runDigest(U, { model });
    const [item] = await getLatestDigest(U);
    expect(await setCandidateFeedback("someone_else", [item.id], { dismiss: true })).toBe(0);
    expect(await setCandidateFeedback(U, [item.id], { helpful: true })).toBe(1);
    expect(await setCandidateFeedback(U, [item.id], { dismiss: true })).toBe(1);
    const [row] = await getTestDb().select().from(insightCandidates).where(eq(insightCandidates.id, item.id));
    expect(row.helpful).toBe(true);
    expect(row.dismissedAt).not.toBeNull();
    expect(await getLatestDigest(U)).toEqual([]);
  });
});
