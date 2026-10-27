/**
 * Chat tool evals over the seed profiles (no model):
 * - date ranges resolve in the user's time zone and are echoed back
 * - every figure matches independent SQL to the cent
 * - tools are scoped to the session user: another user's rows and account
 *   ids are unreachable, and userId is not an input
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { CUSTOM_PROFILES, seedProfile, seedUser, sqlCountMatching, sqlMoneyInCents, sqlNetSpendingByBucket } from "../setup/chat-fixtures";
import { buildTools, forModel, type ChatTools } from "@/lib/chat/tools";
import { resolveRange } from "@/lib/chat/values";
import { calendarPeriod, utcAddDays, utcStartOfDay } from "@/lib/analytics/periods";
import { calendarDateInTimeZone } from "@/lib/utils/time-zone";
import { toDateParam } from "@/lib/utils/date-ranges";

type Name = keyof ChatTools;

/** Validate input with the tool's own schema (as the SDK does), then execute. */
async function run<N extends Name>(tools: ChatTools, name: N, input: unknown) {
  const t = tools[name] as unknown as { inputSchema: z.ZodType; execute: (i: unknown, o: unknown) => Promise<unknown> };
  return (await t.execute(t.inputSchema.parse(input), { toolCallId: "t", messages: [] })) as Record<string, never>;
}

const today = utcStartOfDay(new Date());
const exclusive = (to: string) => toDateParam(utcAddDays(new Date(`${to}T00:00:00Z`), 1));

describe("date ranges", () => {
  it("resolve presets against the user's calendar date, not the server's", () => {
    // 03:00 UTC on Nov 1 is still Oct 31 in Los Angeles.
    const now = new Date("2026-11-01T03:00:00Z");
    const la = calendarDateInTimeZone(now, "America/Los_Angeles");
    const r = resolveRange({ preset: "last_month" }, la, "America/Los_Angeles");
    expect(r).toMatchObject({ range: { from: "2026-09-01", to: "2026-09-30", label: "September 2026", isPartial: false, timeZone: "America/Los_Angeles" } });
    const utc = resolveRange({ preset: "last_month" }, calendarDateInTimeZone(now, "UTC"), "UTC");
    expect(utc).toMatchObject({ range: { from: "2026-10-01", to: "2026-10-31" } });
  });

  it("echo explicit dates inclusively, swap reversed ones and flag partial periods", () => {
    const t = new Date("2026-10-27T00:00:00Z");
    expect(resolveRange({ from: "2026-10-31", to: "2026-10-01" }, t, "UTC")).toMatchObject({
      range: { from: "2026-10-01", to: "2026-10-31", days: 31, isPartial: true },
    });
    expect(resolveRange({ preset: "this_month" }, t, "UTC")).toMatchObject({ range: { isPartial: true } });
    expect(resolveRange({ from: "2020-01-01", to: "2026-01-01" }, t, "UTC")).toEqual({ error: expect.stringMatching(/three years/) });
    expect(resolveRange({ from: "2026-02-30", to: "2026-03-01" }, t, "UTC")).toEqual({ error: expect.any(String) });
  });
});

describe.each(CUSTOM_PROFILES.map((p) => [p.username, p] as const))("numeric correctness: %s", (username, profile) => {
  const U = `u_${username}`;

  it("spending, comparison, cash flow and search match SQL to the cent", async () => {
    await seedUser(U);
    await seedProfile(U, profile);
    const tools = buildTools({ userId: U, today, timeZone: "UTC" });

    // Spending summary for last month, by category.
    const last = calendarPeriod("month", today, -1);
    const from = toDateParam(last.start);
    const to = toDateParam(last.end);
    const summary = await run(tools, "getSpendingSummary", { range: { preset: "last_month" }, groupBy: "category", limit: 20 });
    expect(summary.range).toMatchObject({ from, to: toDateParam(utcAddDays(last.end, -1)) });
    const truth = await sqlNetSpendingByBucket(U, from, to);
    const totalCents = [...truth.values()].reduce((a, b) => a + b, 0);
    expect(truth.size).toBeGreaterThan(2); // the profile has real spending last month
    expect((summary.total as { cents: number }).cents).toBe(totalCents);
    for (const item of summary.items as Array<{ key: string; amount: { cents: number } }>) {
      expect({ bucket: item.key, cents: item.amount.cents }).toEqual({ bucket: item.key, cents: truth.get(item.key) });
    }

    // Last month against the month before: delta = A − B, from SQL.
    const prev = calendarPeriod("month", today, -2);
    const truthB = await sqlNetSpendingByBucket(U, toDateParam(prev.start), toDateParam(prev.end));
    const totalB = [...truthB.values()].reduce((a, b) => a + b, 0);
    const cmp = await run(tools, "compareSpending", {
      rangeA: { preset: "last_month" },
      rangeB: { from: toDateParam(prev.start), to: toDateParam(utcAddDays(prev.end, -1)) },
    });
    expect((cmp.totalA as { cents: number }).cents).toBe(totalCents);
    expect((cmp.totalB as { cents: number }).cents).toBe(totalB);
    expect((cmp.change as { delta: { cents: number } }).delta.cents).toBe(totalCents - totalB);

    // Money in over the last 90 days.
    const flow = await run(tools, "getCashflow", { range: { preset: "last_90_days" } });
    const r90 = flow.range as unknown as { from: string; to: string };
    expect((flow.moneyIn as { cents: number }).cents).toBe(await sqlMoneyInCents(U, r90.from, exclusive(r90.to)));

    // Search: the match count is the SQL count over the same rows.
    const search = await run(tools, "searchTransactions", { text: "AMAZON", range: { preset: "last_90_days" }, limit: 5 });
    const expected = await sqlCountMatching(U, "AMAZON", r90.from, exclusive(r90.to));
    console.log(`${username}: last month ${(summary.items as unknown[]).length} categories, AMAZON matches ${expected}`);
    expect(search.totalMatches).toBe(expected);
    expect(search.truncated).toBe(expected > 5);
    expect((search.transactions as unknown[]).length).toBe(Math.min(5, expected));
  }, 60_000);
});

describe("cross-user isolation", () => {
  it("never returns another user's rows or accepts their account ids", async () => {
    const [alex, other] = [CUSTOM_PROFILES[0], CUSTOM_PROFILES[1] ?? CUSTOM_PROFILES[0]];
    await seedUser("u_a");
    await seedUser("u_b");
    await seedProfile("u_a", alex);
    const bAccounts = await seedProfile("u_b", other);

    const tools = buildTools({ userId: "u_a", today, timeZone: "UTC" });
    const res = await run(tools, "searchTransactions", { accountId: bAccounts[0] });
    expect(res).toEqual({ error: expect.stringMatching(/Unknown accountId/) });

    const accounts = await run(tools, "getAccounts", {});
    const ids = (accounts.accounts as Array<{ id: string }>).map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => bAccounts.includes(id))).toBe(false);

    const all = await run(tools, "searchTransactions", { range: { preset: "last_year" }, limit: 25 });
    const json = JSON.stringify(all);
    expect(json).not.toContain("u_b_");

    // userId is not part of any input schema: strict schemas reject it.
    expect(() => (tools.getAccounts.inputSchema as unknown as z.ZodType).parse({ userId: "u_b" })).toThrow();
    expect(() =>
      (tools.getSpendingSummary.inputSchema as unknown as z.ZodType).parse({ range: { preset: "this_month" }, userId: "u_b" }),
    ).toThrow();
  }, 60_000);
});

describe("model-facing output", () => {
  it("replaces person-to-person names with tokens and keeps labels for the UI", () => {
    const out = { items: [{ label: "Zelle payment to Jane Doe", modelLabel: "Contact KX", amount: { cents: 100, display: "$1.00" } }] };
    expect(forModel(out)).toEqual({ items: [{ label: "Contact KX", amount: { cents: 100, display: "$1.00" } }] });
  });
});
