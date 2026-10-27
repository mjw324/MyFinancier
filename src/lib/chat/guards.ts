/**
 * Deterministic checks around every chat answer (OWASP: validate model output
 * with code, not with another prompt).
 *
 * checkFigures: every currency or percentage figure in the answer must appear
 *   in, or follow trivially from, that turn's grounding data (tool outputs and
 *   the snapshot, both computed by the app). "Trivially" means: the same value
 *   rounded to whole dollars, abbreviated ($1.2k), as a magnitude, or the sum,
 *   difference or ratio of two grounded values. Anything else is reported.
 *
 * checkScope: budgeting and education are in scope; recommending specific
 *   securities (buy / sell / hold a stock, fund, ETF or coin) is not. Run on
 *   the user's message (answered with a fixed redirect, no model call) and on
 *   the answer (a matching answer is withheld).
 */

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

const CURRENCY_RE = /([-−+]?)\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(k|K|thousand|m|M|million)?\b/g;
const PERCENT_RE = /([-−+]?)(\d+(?:\.\d+)?)\s?(%|percent\b)/g;

export interface Figure {
  text: string;
  kind: "money" | "percent";
  /** Cents for money, percent for percent (magnitude). */
  value: number;
  /** Tolerance from the precision the answer wrote it with. */
  tolerance: number;
}

export function extractFigures(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(CURRENCY_RE)) {
    const whole = Number(m[2].replace(/,/g, ""));
    const frac = m[3] ? Number(m[3]) : 0;
    const unit = m[4]?.toLowerCase();
    const scale = unit === "k" || unit === "thousand" ? 1_000 : unit === "m" || unit === "million" ? 1_000_000 : 1;
    const dollars = (whole + frac) * scale;
    const decimals = m[3] ? m[3].length - 1 : 0;
    // "$1,234" may be a rounded $1,233.60; "$1.2k" may be anything from $1,150.
    const tolerance = scale > 1 ? Math.round(0.5 * 10 ** -decimals * scale * 100) : decimals >= 2 ? 0 : decimals === 1 ? 5 : 50;
    out.push({ text: m[0].trim(), kind: "money", value: Math.round(dollars * 100), tolerance });
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    const decimals = m[2].includes(".") ? m[2].split(".")[1].length : 0;
    out.push({ text: m[0].trim(), kind: "percent", value: Number(m[2]), tolerance: 0.5 * 10 ** -decimals });
  }
  return out;
}

export interface Grounding {
  /** Money values in cents (magnitudes). */
  money: number[];
  /** Percent values (magnitudes, e.g. 12 for 12%). */
  percents: number[];
}

/**
 * Collect every figure in tool outputs / the snapshot: `cents` fields,
 * percent `value` / `pctChange` fields, and any figure written inside a
 * string (display strings, labels).
 */
export function collectGrounding(sources: unknown[]): Grounding {
  const money = new Set<number>();
  const percents = new Set<number>();
  const walk = (v: unknown, key: string | null) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      if (key === "cents") money.add(Math.abs(v));
      else if (key === "pctChange" || key === "value") percents.add(Math.abs(v));
      return;
    }
    if (typeof v === "string") {
      for (const f of extractFigures(v)) (f.kind === "money" ? money : percents).add(Math.abs(f.value));
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, null));
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  sources.forEach((s) => walk(s, null));
  return { money: [...money], percents: [...percents] };
}

/** Pairwise derivations are bounded so a huge tool output can't make the check quadratic in practice. */
const MAX_PAIRWISE = 400;

function moneyGrounded(f: Figure, g: Grounding): boolean {
  const near = (x: number) => Math.abs(x - f.value) <= f.tolerance;
  if (f.value === 0 || g.money.some(near)) return true;
  const vals = g.money.slice(0, MAX_PAIRWISE);
  for (let i = 0; i < vals.length; i++) {
    for (let j = i + 1; j < vals.length; j++) {
      if (near(vals[i] + vals[j]) || near(Math.abs(vals[i] - vals[j]))) return true;
    }
  }
  return false;
}

function percentGrounded(f: Figure, g: Grounding): boolean {
  const near = (x: number) => Math.abs(x - f.value) <= Math.max(f.tolerance, 0.5);
  if (f.value === 0 || f.value === 100 || g.percents.some(near)) return true;
  // A share of a total, or a change between two grounded amounts.
  const vals = g.money.filter((v) => v > 0).slice(0, MAX_PAIRWISE);
  for (let i = 0; i < vals.length; i++) {
    for (let j = 0; j < vals.length; j++) {
      if (i === j) continue;
      if (near((vals[i] / vals[j]) * 100) || near(Math.abs(vals[i] - vals[j]) / vals[j] * 100)) return true;
    }
  }
  return false;
}

export interface FigureCheck {
  ok: boolean;
  checked: number;
  unverified: string[];
}

export function checkFigures(answer: string, grounding: Grounding): FigureCheck {
  const figures = extractFigures(answer);
  const unverified = figures
    .filter((f) => !(f.kind === "money" ? moneyGrounded(f, grounding) : percentGrounded(f, grounding)))
    .map((f) => f.text);
  return { ok: unverified.length === 0, checked: figures.length, unverified: [...new Set(unverified)] };
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

const SECURITY =
  String.raw`(?:stocks?|shares?|equit(?:y|ies)|etfs?|index funds?|mutual funds?|funds?|bonds?|options?|calls?|puts?|crypto(?:currenc(?:y|ies))?|coins?|tokens?|bitcoin|btc|ethereum|eth|solana|dogecoin|nfts?|reits?|penny stocks?|securit(?:y|ies)|tickers?)`;
const TICKER = String.raw`(?:\$[A-Z]{1,5}\b|\b[A-Z]{2,5}\b(?=\s+(?:stock|shares?|calls?|puts?|etf)))`;
const TRADE = String.raw`(?:buy(?:ing)?|sell(?:ing)?|short(?:ing)?|hold(?:ing)?|invest(?:ing)?\s+in|put\s+(?:my\s+)?money\s+in(?:to)?|dump(?:ing)?|load(?:ing)?\s+up\s+on)`;

const REQUEST_PATTERNS: RegExp[] = [
  // "should I buy Tesla stock", "is it a good time to sell my ETH"
  new RegExp(String.raw`\b(?:should|shall|would|do you think)\s+(?:i|we)\b[^.?!]{0,40}\b${TRADE}\b[^.?!]{0,40}(?:${SECURITY}|${TICKER})`, "i"),
  new RegExp(String.raw`\b${TRADE}\s+${TICKER}`),
  // "which stock should I buy", "best crypto to invest in", "what ETF do you recommend"
  new RegExp(String.raw`\b(?:which|what|best|top|good)\s+(?:\w+\s+){0,2}${SECURITY}\b[^.?!]{0,40}\b(?:should|to|do you|would you|recommend|pick)`, "i"),
  new RegExp(String.raw`\b(?:recommend|suggest|pick)\s+(?:me\s+)?(?:a|an|some|the best)?\s*(?:\w+\s+)?${SECURITY}\b`, "i"),
  // "how should I allocate my portfolio", "what's a good asset allocation for me"
  new RegExp(String.raw`\b(?:allocate|allocation|rebalance)\b[^.?!]{0,30}\b(?:my|portfolio|401k|ira|investments?)\b`, "i"),
];

const ANSWER_PATTERNS: RegExp[] = [
  // "I recommend buying VTI", "you should sell your bitcoin", "consider investing in an S&P 500 index fund"
  new RegExp(String.raw`\b(?:i(?:'d| would)?\s+(?:recommend|suggest)|you\s+(?:should|could|might want to)|consider)\s+(?:\w+\s+){0,2}${TRADE}\b[^.!?\n]{0,50}(?:${SECURITY}|${TICKER})`, "i"),
  new RegExp(String.raw`\b(?:good|great|solid|smart)\s+(?:\w+\s+)?(?:buy|investment|pick)\b[^.!?\n]{0,30}${TICKER}`, "i"),
  new RegExp(String.raw`\b(?:allocate|put)\s+\d+\s?%\s+(?:of\s+\w+\s+)?(?:in(?:to)?|to)\s+[^.!?\n]{0,30}${SECURITY}`, "i"),
];

export type ScopeVerdict = { allowed: true } | { allowed: false; reason: "securities_advice" };

export function checkScope(text: string, on: "request" | "answer"): ScopeVerdict {
  const patterns = on === "request" ? REQUEST_PATTERNS : ANSWER_PATTERNS;
  return patterns.some((p) => p.test(text)) ? { allowed: false, reason: "securities_advice" } : { allowed: true };
}

/** The fixed reply when a request or answer is out of scope. Contains no figures. */
export const SCOPE_REDIRECT =
  "I can't recommend specific stocks, funds, crypto or other investments, or tell you how to allocate a portfolio: that's personalized investment advice, which this assistant doesn't give. I can help with your budget, your spending and saving, how much you've been setting aside each month, or explain general ideas like how index funds or compound interest work. For advice about investments, a licensed financial adviser is the right person to ask.";
