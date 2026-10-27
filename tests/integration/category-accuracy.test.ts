/**
 * Per-category accuracy of category suggestions over every transaction in the
 * seed profiles, labeled in tests/setup/category-labels.ts.
 *
 * Runs the full job (selection, grouping, batching, ref mapping, storage)
 * against PGlite with the AI SDK mock model, never a real API. The mock is a
 * labeler that answers each descriptor it is shown, so these figures measure
 * whether the pipeline keeps every answer on the right rows across batches,
 * not how well Claude categorizes; scripts/eval-categorize.ts runs the same
 * scoring against the real small-tier model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";
import { mockModel, promptItems } from "../setup/mock-model";
import { labelFor } from "../setup/category-labels";
import { buildProfiles } from "../../scripts/seed-profiles";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { categorySuggestions } from "@/lib/db/schema/categorize";
import { suggestCategories, toItemFields, BATCH_SIZE } from "@/lib/categorize/suggest";
import { formatScore, scoreSuggestions } from "@/lib/categorize/eval";

const U = "u_acc";

type Row = { id: string; name: string; amount: number; label: string };

function seedRows(): Row[] {
  let n = 0;
  return buildProfiles().flatMap((p) =>
    p.items.flatMap((item) =>
      item.kind === "custom"
        ? item.accounts.flatMap((a) =>
            a.transactions.map((t) => ({ id: `acc_${n++}`, name: t.description, amount: t.amount, label: labelFor(t.description, t.amount)! })),
          )
        : [],
    ),
  );
}

const key = (r: Pick<Row, "name" | "amount">) =>
  JSON.stringify(toItemFields({ name: r.name, merchantName: null, amount: String(r.amount), category: null }));

beforeEach(() => vi.stubEnv("AI_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("category accuracy over the seed profiles", () => {
  const rows = seedRows();

  it("labels every seed description", () => {
    expect(rows.filter((r) => !r.label).map((r) => r.name)).toEqual([]);
    // One label per descriptor the model sees, or the ceiling is below 100%.
    const labels = new Map<string, Set<string>>();
    for (const r of rows) labels.set(key(r), (labels.get(key(r)) ?? new Set()).add(r.label));
    expect([...labels].filter(([, l]) => l.size > 1)).toEqual([]);
  });

  it("puts every answer on the right rows, per category", async () => {
    const db = getTestDb();
    await db.insert(user).values(makeUser({ id: U }));
    await db.insert(plaidItems).values(makePlaidItem({ id: "pi_acc", userId: U }));
    await db.insert(financialAccounts).values(makeAccount({ id: "acct_acc", userId: U, plaidItemId: "pi_acc" }));
    await db.insert(userPreferences).values({ userId: U, aiOptIn: true, aiConsentAt: new Date(), aiConsentVersion: "v1" });

    // Newest first is what the job takes; keep one row per descriptor and
    // direction so the whole set fits a run (MAX_BATCHES × BATCH_SIZE).
    const sample = [...new Map(rows.map((r) => [key(r), r])).values()];
    expect(sample.length).toBeGreaterThan(BATCH_SIZE); // more than one batch
    for (let i = 0; i < sample.length; i += 200) {
      await db.insert(transactions).values(
        sample.slice(i, i + 200).map((r, j) =>
          makeTxn({
            id: r.id,
            userId: U,
            accountId: "acct_acc",
            name: r.name,
            amount: String(r.amount),
            merchantName: null,
            pfcConfidenceLevel: "UNKNOWN",
            date: new Date(Date.UTC(2026, 0, 1) + (i + j) * 60_000),
          }),
        ),
      );
    }

    const truth = new Map(sample.map((r) => [key(r), r.label]));
    const { model, prompts } = mockModel((prompt) =>
      promptItems(prompt).map(({ ref, ...fields }) => ({ ref, category: truth.get(JSON.stringify(fields)) ?? "uncertain" })),
    );
    const res = await suggestCategories({ userId: U, model });
    expect(res.status).toBe("ok");
    expect(prompts.length).toBeGreaterThan(1);

    const stored = new Map(
      (await db.select({ id: categorySuggestions.transactionId, s: categorySuggestions.suggested }).from(categorySuggestions)).map((r) => [r.id, r.s]),
    );
    const score = scoreSuggestions(sample.map((r) => ({ label: r.label, predicted: stored.get(r.id) ?? null })));
    console.log(`Category suggestions, seed profiles (mock labeler):\n${formatScore(score)}`);

    expect(score.overall.coverage).toBe(1);
    for (const [category, s] of Object.entries(score.byCategory)) {
      expect({ category, accuracy: s.accuracy, precision: s.precision }).toEqual({ category, accuracy: 1, precision: 1 });
    }
  });
});
