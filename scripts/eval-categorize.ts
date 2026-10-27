/**
 * Live per-category accuracy of the small-tier model on the seed profiles'
 * descriptors (labels in tests/setup/category-labels.ts). Calls the real
 * provider, so it is a script, not a test, and is never run in CI.
 *
 *   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm dlx tsx@4.19.2 scripts/eval-categorize.ts
 *
 * EFFORT=low|medium overrides CATEGORIZE_EFFORT to compare levels.
 *
 * No database: usage is summed here instead of written to ai_usage.
 */

import type { LanguageModelUsage } from "ai";
import { buildProfiles } from "./seed-profiles";
import { labelFor } from "../tests/setup/category-labels";
import { getModel } from "../src/lib/ai/provider";
import { BATCH_SIZE, CATEGORIZE_EFFORT, categorizeBatch, toItemFields } from "../src/lib/categorize/suggest";
import { formatScore, scoreSuggestions } from "../src/lib/categorize/eval";
import { isPlaidPrimary } from "../src/lib/categorize/categories";

async function main() {
  const rows = buildProfiles().flatMap((p) =>
    p.items.flatMap((item) =>
      item.kind === "custom" ? item.accounts.flatMap((a) => a.transactions.map((t) => ({ name: t.description, amount: t.amount }))) : [],
    ),
  );
  const byKey = new Map<string, { fields: ReturnType<typeof toItemFields>; label: string }>();
  for (const r of rows) {
    const fields = toItemFields({ name: r.name, merchantName: null, amount: String(r.amount), category: null });
    byKey.set(JSON.stringify(fields), { fields, label: labelFor(r.name, r.amount) ?? "UNLABELED" });
  }
  const items = [...byKey.values()];
  const model = getModel("small");
  const effort = process.env.EFFORT === "low" || process.env.EFFORT === "medium" ? process.env.EFFORT : CATEGORIZE_EFFORT;
  let input = 0;
  let output = 0;
  const recordUsage = async (u: LanguageModelUsage) => {
    input += u.inputTokens ?? 0;
    output += u.outputTokens ?? 0;
  };

  const predictions: Array<{ label: string; predicted: string | null }> = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const answers = await categorizeBatch({ userId: "eval", fields: batch.map((b) => b.fields), model, recordUsage, effort });
    batch.forEach((b, j) => predictions.push({ label: b.label, predicted: isPlaidPrimary(answers[j]) ? answers[j] : null }));
  }
  console.log(formatScore(scoreSuggestions(predictions)));
  console.log(`effort: ${effort}; tokens: ${input} in, ${output} out`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
