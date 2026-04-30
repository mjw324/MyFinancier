const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export function formatCurrency(
  amount: number | string | null,
  currency?: string,
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  if (currency && currency !== "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(num);
  }
  return currencyFormatter.format(num);
}

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompactCurrency(amount: number): string {
  return compactCurrencyFormatter.format(amount);
}

/**
 * Single source of truth for resolving the human-facing label for a
 * transaction or recurring stream. User-set aliases (`customName`) win over
 * Plaid's enriched merchant name, which wins over the raw description/name.
 * Use this anywhere you'd otherwise write `customName ?? merchantName ?? …`.
 */
export function displayName(parts: {
  customName?: string | null;
  merchantName?: string | null;
  fallback?: string | null;
}): string {
  return (
    parts.customName?.trim() ||
    parts.merchantName?.trim() ||
    parts.fallback?.trim() ||
    ""
  );
}

export function formatDate(
  date: Date | string,
  style: "short" | "long" = "short",
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: style === "short" ? "short" : "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(d, "short");
}

export function formatCategory(category: string): string {
  return category
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Each category gets a unique fill hue spaced ~22° apart for maximum
// perceptual distance on pie/donut charts. bg/text hues are kept close
// to fill for visual consistency in badges and tooltips.
const CATEGORY_COLORS: Record<string, { bg: string; text: string; fill: string }> = {
  INCOME:                    { bg: "oklch(0.95 0.05 145)", text: "oklch(0.40 0.10 145)", fill: "oklch(0.65 0.18 145)" },
  TRANSFER_IN:               { bg: "oklch(0.95 0.05 165)", text: "oklch(0.40 0.10 165)", fill: "oklch(0.65 0.18 165)" },
  FOOD_AND_DRINK:            { bg: "oklch(0.94 0.06 55)",  text: "oklch(0.42 0.12 55)",  fill: "oklch(0.65 0.18 55)" },
  GENERAL_MERCHANDISE:       { bg: "oklch(0.94 0.05 260)", text: "oklch(0.42 0.12 260)", fill: "oklch(0.65 0.18 260)" },
  TRANSPORTATION:            { bg: "oklch(0.94 0.05 210)", text: "oklch(0.42 0.12 210)", fill: "oklch(0.65 0.18 210)" },
  TRAVEL:                    { bg: "oklch(0.93 0.06 190)", text: "oklch(0.40 0.12 190)", fill: "oklch(0.65 0.18 190)" },
  ENTERTAINMENT:             { bg: "oklch(0.93 0.06 310)", text: "oklch(0.40 0.12 310)", fill: "oklch(0.65 0.18 310)" },
  PERSONAL_CARE:             { bg: "oklch(0.94 0.06 340)", text: "oklch(0.42 0.12 340)", fill: "oklch(0.65 0.18 340)" },
  RENT_AND_UTILITIES:        { bg: "oklch(0.94 0.05 80)",  text: "oklch(0.42 0.12 80)",  fill: "oklch(0.65 0.18 80)" },
  GENERAL_SERVICES:          { bg: "oklch(0.94 0.04 122)", text: "oklch(0.42 0.10 122)", fill: "oklch(0.65 0.18 122)" },
  GOVERNMENT_AND_NON_PROFIT: { bg: "oklch(0.94 0.04 280)", text: "oklch(0.42 0.10 280)", fill: "oklch(0.65 0.18 280)" },
  HOME_IMPROVEMENT:          { bg: "oklch(0.94 0.05 100)", text: "oklch(0.42 0.12 100)", fill: "oklch(0.65 0.18 100)" },
  MEDICAL:                   { bg: "oklch(0.94 0.06 10)",  text: "oklch(0.42 0.12 10)",  fill: "oklch(0.65 0.18 10)" },
  BANK_FEES:                 { bg: "oklch(0.93 0.06 35)",  text: "oklch(0.40 0.12 35)",  fill: "oklch(0.65 0.18 35)" },
  LOAN_PAYMENTS:             { bg: "oklch(0.94 0.04 235)", text: "oklch(0.42 0.10 235)", fill: "oklch(0.65 0.18 235)" },
  TRANSFER_OUT:              { bg: "oklch(0.93 0.04 300)", text: "oklch(0.40 0.10 300)", fill: "oklch(0.65 0.18 300)" },
};

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getCategoryColor(category: string): { bg: string; text: string; fill: string } {
  const upper = category.toUpperCase().replace(/\s+/g, "_");
  if (CATEGORY_COLORS[upper]) return CATEGORY_COLORS[upper];
  // Unknown categories get a deterministic hue based on name hash
  const hue = (hashString(upper) * 137) % 360; // golden-angle spacing
  return {
    bg: `oklch(0.94 0.05 ${hue})`,
    text: `oklch(0.42 0.11 ${hue})`,
    fill: `oklch(0.65 0.18 ${hue})`,
  };
}
