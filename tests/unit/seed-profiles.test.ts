import { describe, expect, it } from "vitest";
import { isBuiltInBudgetKey } from "@/lib/budgets/categories";
import { buildProfiles, customConfig, MAX_CUSTOM_CONFIG_BYTES } from "../../scripts/seed-profiles";

const profiles = buildProfiles();
const customItems = profiles.flatMap((p) =>
  p.items.flatMap((item) => (item.kind === "custom" ? [{ profile: p.username, item }] : [])),
);

describe("seed profiles", () => {
  it("is deterministic", () => {
    expect(JSON.stringify(buildProfiles())).toBe(JSON.stringify(profiles));
  });

  it("uses usernames the app accepts, once each", () => {
    const names = profiles.map((p) => p.username);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]{4,10}$/);
  });

  it("links each profile's Items at different institutions", () => {
    for (const p of profiles) {
      const ids = p.items.map((i) => i.institutionId);
      expect(new Set(ids).size, p.username).toBe(ids.length);
    }
  });

  it.each(customItems)("$profile $item.institutionId fits Plaid's request size", ({ item }) => {
    expect(customConfig(item.accounts).length).toBeLessThanOrEqual(MAX_CUSTOM_CONFIG_BYTES);
  });

  it("dates every transaction in the past two years, posted on or after the transaction", () => {
    const today = new Date().toISOString().slice(0, 10);
    const oldest = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
    for (const { item } of customItems) {
      for (const a of item.accounts) {
        for (const t of a.transactions) {
          expect(t.date_posted < today).toBe(true);
          expect(t.date_transacted >= oldest).toBe(true);
          expect(t.date_posted >= t.date_transacted).toBe(true);
        }
      }
    }
  });

  it("only budgets built-in categories", () => {
    for (const p of profiles) {
      for (const b of p.budgets ?? []) expect(isBuiltInBudgetKey(b.categoryKey), b.categoryKey).toBe(true);
    }
  });
});
