import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatCompactCurrency,
  formatCategory,
  getCategoryColor,
} from "@/lib/utils/format";

describe("formatCurrency", () => {
  it("formats positive USD with two decimals and $ symbol", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats negative as -$X.XX", () => {
    // Intl renders this as "-$10.00" in en-US
    expect(formatCurrency(-10)).toBe("-$10.00");
  });

  it("parses string input", () => {
    expect(formatCurrency("99.9")).toBe("$99.90");
  });

  it("falls back to 0 when amount is null", () => {
    expect(formatCurrency(null)).toBe("$0.00");
  });

  it("supports a non-USD currency override", () => {
    // exact format is locale-dependent, so we just assert the EUR symbol appears
    const out = formatCurrency(50, "EUR");
    expect(out).toMatch(/€|EUR/);
  });
});

describe("formatCompactCurrency", () => {
  it("uses compact notation for thousands", () => {
    expect(formatCompactCurrency(1500)).toBe("$1.5K");
  });

  it("uses compact notation for millions", () => {
    expect(formatCompactCurrency(2_300_000)).toBe("$2.3M");
  });

  it("formats small amounts without compaction", () => {
    expect(formatCompactCurrency(42)).toBe("$42");
  });
});

describe("formatCategory", () => {
  it("converts SCREAMING_SNAKE_CASE to Title Case", () => {
    expect(formatCategory("FOOD_AND_DRINK")).toBe("Food And Drink");
  });

  it("handles single-word categories", () => {
    expect(formatCategory("INCOME")).toBe("Income");
  });

  it("handles already-spaced lowercase input", () => {
    expect(formatCategory("transfer in")).toBe("Transfer In");
  });
});

describe("getCategoryColor", () => {
  it("returns the predefined palette for known categories", () => {
    const food = getCategoryColor("FOOD_AND_DRINK");
    expect(food.bg).toContain("oklch");
    expect(food.fill).toContain("oklch");
    // Same input → same output
    expect(getCategoryColor("FOOD_AND_DRINK")).toEqual(food);
  });

  it("normalizes lowercased / spaced input to the same palette entry", () => {
    expect(getCategoryColor("food and drink")).toEqual(
      getCategoryColor("FOOD_AND_DRINK"),
    );
  });

  it("returns deterministic colors for unknown categories", () => {
    const a = getCategoryColor("UNKNOWN_CATEGORY_XYZ");
    const b = getCategoryColor("UNKNOWN_CATEGORY_XYZ");
    expect(a).toEqual(b);
    expect(a.bg).toContain("oklch");
  });

  it("returns different colors for different unknown categories", () => {
    const a = getCategoryColor("FOO_CATEGORY");
    const b = getCategoryColor("BAR_CATEGORY");
    expect(a).not.toEqual(b);
  });
});
