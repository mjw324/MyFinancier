/**
 * Numeric correctness of the weekly digest over every seed profile: whatever
 * the model writes, every figure a user reads comes from the candidate's
 * payload. Uses the AI SDK's mock model; never calls a real API.
 */
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { buildProfiles } from "../../scripts/seed-profiles";
import { seedProfileInputs } from "../setup/seed-insight-inputs";
import { detectCandidates, selectForDigest } from "@/lib/insights/detectors";
import { generateDigest, type DigestCandidate } from "@/lib/insights/digest";
import type { Candidate } from "@/lib/insights/types";
import { formatMoneyShort, formatRatio } from "@/lib/analytics/labels";

vi.mock("@/lib/ai/usage", () => ({ recordAiUsage: vi.fn(async () => {}) }));

const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const profiles = buildProfiles().filter((p) => p.items.some((i) => i.kind === "custom"));

type Finding = { candidateId: string; type: string; facts: Record<string, string> };
type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];
type TestCandidate = DigestCandidate & Candidate;

function findingsOf(options: CallOptions): Finding[] {
  const user = options.prompt.find((m) => m.role === "user");
  const part = user && Array.isArray(user.content) ? user.content.find((c) => c.type === "text") : null;
  return (JSON.parse(part && "text" in part ? part.text : "{}") as { findings: Finding[] }).findings;
}

/** A mock model that writes elements from the findings it was shown. */
function model(write: (findings: Finding[]) => unknown[], seen?: string[]) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      seen?.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text: JSON.stringify({ elements: write(findingsOf(options)) }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 800, noCache: 800, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 150, text: 150, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

/** Uses every fact as a placeholder, in the order given. */
const faithful = (fs: Finding[]) =>
  fs.slice(0, 3).map((f) => ({
    candidateId: f.candidateId,
    title: `About {{${Object.keys(f.facts)[0]}}}`,
    body: Object.keys(f.facts).map((k) => `{{${k}}}`).join(", then ") + ".",
  }));

/** Types figures itself (copied, rounded, invented), links, and bad placeholders. */
const hostile = (fs: Finding[]) =>
  fs.flatMap((f, i) => [
    { candidateId: f.candidateId, title: "Act now", body: `You spent ${Object.values(f.facts).join(" ")} this month.` },
    { candidateId: f.candidateId, title: "Big change", body: `Up ${i + 37}% to $9,999 — see https://evil.example` },
    { candidateId: f.candidateId, title: "{{notAFact}}", body: "{{category}} rose by twelve percent." },
    { candidateId: "c99", title: "Ghost", body: "Unknown finding." },
  ]).slice(0, 3);

/** Remove every fact display; any digit left was not from the payload. */
function strayDigits(text: string, c: DigestCandidate): string[] {
  let rest = text;
  for (const f of Object.values(c.payload.facts).sort((a, b) => b.display.length - a.display.length)) {
    rest = rest.split(f.display).join(" ");
  }
  return rest.match(/\d[\d,.]*/g) ?? [];
}

function candidatesFor(profile: (typeof profiles)[number]): TestCandidate[] {
  return detectCandidates(seedProfileInputs(profile, today)).map((c, i) => ({ id: `id_${i}`, ...c }));
}

describe.each(profiles.map((p) => [p.username, p] as const))("digest figures for seed profile %s", (_name, profile) => {
  const candidates = candidatesFor(profile);

  it("produces findings that clear the threshold", () => {
    expect(selectForDigest(candidates).length).toBeGreaterThan(0);
  });

  it("formats each fact exactly from its value", () => {
    for (const c of candidates) {
      for (const [key, f] of Object.entries(c.payload.facts)) {
        if (f.kind === "money") expect(f.display, `${c.fingerprint}.${key}`).toBe(formatMoneyShort(f.value as number));
        if (f.kind === "percent") expect(f.display, `${c.fingerprint}.${key}`).toBe(formatRatio(f.value as number));
        if (f.kind === "count") expect(f.display).toBe(String(f.value));
      }
    }
  });

  it.each([
    ["faithful", faithful],
    ["hostile", hostile],
  ] as const)("with a %s model, every figure comes from the payload", async (_kind, write) => {
    const seen: string[] = [];
    const res = await generateDigest({ userId: `seed_${profile.username}`, candidates, model: model(write, seen) });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.length).toBeLessThanOrEqual(3);
    const byId = new Map(candidates.map((c) => [c.id, c]));
    for (const item of res.items) {
      const c = byId.get(item.candidateId)!;
      expect(c, item.candidateId).toBeDefined();
      for (const text of [item.title, item.body]) {
        expect(strayDigits(text, c), `${c.fingerprint}: ${text}`).toEqual([]);
        expect(text).not.toMatch(/\{\{|https?:|evil/);
      }
    }
    if (_kind === "hostile") expect(res.items.every((i) => i.fromTemplate)).toBe(true);
    if (_kind === "faithful") expect(res.items.every((i) => !i.fromTemplate)).toBe(true);

    // The model never sees the user's name, P2P counterparties or ids.
    const prompt = seen.join("\n");
    for (const secret of [profile.name, "MORGAN DIAZ", "JAMIE LEE", "RILEY CHEN", "PAT RIVERA", "id_0", "stream_1"]) {
      expect(prompt).not.toContain(secret);
    }
  });
});

it("covers most candidate types across the seed profiles", () => {
  const types = new Set(profiles.flatMap((p) => candidatesFor(p).map((c) => c.type)));
  expect(types.size).toBeGreaterThanOrEqual(5);
});
