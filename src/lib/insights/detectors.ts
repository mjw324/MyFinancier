/**
 * Insight candidate detectors. Pure: no I/O, no model. Each detector turns
 * figures the analytics modules already computed into findings whose every
 * number lives in `payload.facts`, pre-formatted for display.
 *
 * Sources:
 *   anomaly, drift, pace, delta  ← src/lib/analytics/trends.ts
 *   new_subscription, price_increase, bill_due ← recurring_streams
 *   budget_pace                  ← getBudgetProgress
 *   safe_to_spend                ← computeSafeToSpend
 *
 * Templates contain no digits: a figure can only appear through a fact.
 */

import { bucketLabel, formatMoneyShort, formatRatio } from "@/lib/analytics/labels";
import {
  computeDelta,
  computeDrift,
  detectAnomalies,
  projectPace,
  SMALL_BASE_THRESHOLD,
} from "@/lib/analytics/trends";
import type { PaceData } from "@/lib/analytics/metrics";
import { roundMoney, sumMoney } from "@/lib/utils/money";
import { transactionsHref, toDateParam } from "@/lib/utils/date-ranges";
import { cleanLabel, counterpartyToken, isPersonToPerson } from "./sanitize";
import type { Candidate, CandidateType, Fact, Severity } from "./types";

/** Candidates scoring below this never reach the model. */
export const DIGEST_SCORE_THRESHOLD = 50;
/** At most this many candidates go to the model; it picks up to three. */
export const MAX_DIGEST_CANDIDATES = 8;

const DAY_MS = 86_400_000;
const NEW_STREAM_DAYS = 60;
const BILL_HORIZON_DAYS = 7;

export interface StreamInput {
  streamId: string;
  flowType: string;
  status: string;
  isActive: boolean;
  frequency: string;
  description: string;
  merchantName: string | null;
  customName: string | null;
  pfcPrimary: string | null;
  firstDate: Date | null;
  predictedNextDate: Date | null;
  averageAmount: number;
  lastAmount: number;
}

export interface BudgetInput {
  budgetId: string;
  categoryKey: string;
  categoryLabel: string;
  budgeted: number;
  spent: number;
  window: { start: string; end: string; label: string; state: string; daysLeft: number };
}

export interface SafeToSpendSummary {
  safeToSpendCents: number;
  billsCents: number;
  through: Date;
}

export interface DetectorInputs {
  userId: string;
  /** The user's calendar date, UTC midnight. */
  today: Date;
  /** Net spending by bucket, month to date. */
  currentBuckets: Map<string, number>;
  /** bucket → complete-month totals, oldest first (from seriesByBucket). */
  series: Map<string, number[]>;
  /** YYYY-MM keys aligned with `series`. */
  months: string[];
  pace: PaceData | null;
  streams: StreamInput[];
  budgets: BudgetInput[];
  safeToSpend: SafeToSpendSummary | null;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

const money = (n: number): Fact => ({ kind: "money", value: roundMoney(Math.abs(n)), display: formatMoneyShort(n) });
const percent = (ratio: number): Fact => ({ kind: "percent", value: ratio, display: formatRatio(ratio) });
const count = (n: number): Fact => ({ kind: "count", value: n, display: String(n) });
const text = (display: string, modelDisplay?: string): Fact =>
  modelDisplay && modelDisplay !== display ? { kind: "text", value: display, display, modelDisplay } : { kind: "text", value: display, display };
const date = (d: Date): Fact => ({
  kind: "date",
  value: toDateParam(d),
  display: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
});

/** Fact builders, shared with other narrated features (explain/slices.ts). */
export const fact = { money, percent, count, text, date };

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const startOfNextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function make(
  type: CandidateType,
  severity: Severity,
  score: number,
  key: string,
  expiresAt: Date,
  payload: Candidate["payload"],
): Candidate {
  return {
    type,
    severity,
    score: Math.max(0, Math.min(100, Math.round(score))),
    fingerprint: `${type}:${key}`,
    expiresAt,
    payload,
  };
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export function anomalyCandidates(i: DetectorInputs): Candidate[] {
  const baseline = new Map([...i.series].map(([k, v]) => [k, v.slice(-6)]));
  const month = toDateParam(i.today).slice(0, 7);
  const from = `${month}-01`;
  return detectAnomalies(i.currentBuckets, baseline).map((a) =>
    make("anomaly", a.severity === "high" ? "high" : "medium", a.severity === "high" ? 80 : 60, `${a.bucket}:${month}`, startOfNextMonth(i.today), {
      subject: a.bucket,
      facts: { category: text(bucketLabel(a.bucket)), current: money(a.current), typical: money(a.typical), excess: money(a.excess) },
      template: {
        title: "{{category}} is running high",
        body: "{{category}} is at {{current}} so far this month, against a typical {{typical}} a month.",
      },
      href: transactionsHref({ from, to: toDateParam(i.today), bucket: a.bucket }),
    }),
  );
}

export function driftCandidates(i: DetectorInputs): Candidate[] {
  const lastSix = new Map([...i.series].map(([k, v]) => [k, v.slice(-6)]));
  const month = i.months.at(-1) ?? "";
  return computeDrift(lastSix).map((d) => {
    const up = d.direction === "up";
    return make("drift", up ? "medium" : "low", up ? (Math.abs(d.absolute) >= 200 ? 65 : 55) : 45, `${d.bucket}:${month}`, startOfNextMonth(i.today), {
      subject: d.bucket,
      facts: { category: text(bucketLabel(d.bucket)), change: money(d.absolute), recent: money(d.recent), prior: money(d.prior) },
      template: up
        ? { title: "{{category}} has crept up", body: "You're spending about {{change}} a month more on {{category}} than in the three months before." }
        : { title: "{{category}} is trending down", body: "You're spending about {{change}} a month less on {{category}} than in the three months before." },
    });
  });
}

export function paceCandidates(i: DetectorInputs): Candidate[] {
  if (!i.pace) return [];
  const p = projectPace(i.pace);
  const ratio = p.variableRatioAhead;
  if (ratio === null || p.elapsedDays < 5 || Math.abs(ratio) < 0.15) return [];
  const ahead = ratio > 0;
  const month = toDateParam(i.today).slice(0, 7);
  return [
    make("pace", ahead ? "medium" : "low", ahead ? (ratio >= 0.3 ? 60 : 50) : 40, `${month}:${ahead ? "ahead" : "behind"}`, startOfNextMonth(i.today), {
      subject: "pace",
      facts: { ratio: percent(ratio), projected: money(p.projected.total) },
      template: ahead
        ? { title: "Spending is ahead of last month", body: "Day-to-day spending is {{ratio}} ahead of last month at this point; with fixed costs the month is on track for about {{projected}}." }
        : { title: "Spending is below last month", body: "Day-to-day spending is {{ratio}} below last month at this point; with fixed costs the month is on track for about {{projected}}." },
    }),
  ];
}

/** Last complete month against the one before, total spending across buckets. */
export function deltaCandidates(i: DetectorInputs): Candidate[] {
  if (i.months.length < 2) return [];
  const total = (idx: number) => sumMoney([...i.series.values()].map((v) => v[idx] ?? 0));
  const n = i.months.length;
  const d = computeDelta(total(n - 1), total(n - 2));
  if (d.ratio === null || Math.abs(d.ratio) < 0.15 || Math.abs(d.absolute) < 100) return [];
  const up = d.direction === "up";
  const key = i.months[n - 1];
  return [
    make("delta", up ? "medium" : "low", up ? 55 : 40, key, startOfNextMonth(i.today), {
      subject: "delta",
      facts: {
        month: text(monthLabel(key)),
        previousMonth: text(monthLabel(i.months[n - 2])),
        current: money(d.current),
        previous: money(d.previous),
        change: money(d.absolute),
        ratio: percent(d.ratio),
      },
      template: {
        title: up ? "{{month}} cost more than {{previousMonth}}" : "{{month}} cost less than {{previousMonth}}",
        body: up
          ? "Spending was {{current}} in {{month}}, {{change}} ({{ratio}}) more than {{previousMonth}}."
          : "Spending was {{current}} in {{month}}, {{change}} ({{ratio}}) less than {{previousMonth}}.",
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Recurring streams
// ---------------------------------------------------------------------------

const FREQUENCY_WORDS: Record<string, string> = {
  WEEKLY: "every week",
  BIWEEKLY: "every two weeks",
  SEMI_MONTHLY: "twice a month",
  MONTHLY: "a month",
  ANNUALLY: "a year",
};

function streamFacts(i: DetectorInputs, s: StreamInput): Record<string, Fact> {
  const label = cleanLabel(s.customName ?? s.merchantName ?? s.description) || "A recurring charge";
  const token = isPersonToPerson(s) ? counterpartyToken(i.userId, label) : undefined;
  return { merchant: text(label, token), frequency: text(FREQUENCY_WORDS[s.frequency] ?? "regularly") };
}

const isLiveOutflow = (s: StreamInput) => s.flowType === "outflow" && s.isActive && s.status !== "TOMBSTONED";

export function newSubscriptionCandidates(i: DetectorInputs): Candidate[] {
  return i.streams
    .filter(isLiveOutflow)
    .filter((s) => s.firstDate && i.today.getTime() - s.firstDate.getTime() <= NEW_STREAM_DAYS * DAY_MS)
    .filter((s) => Math.abs(s.lastAmount) >= 1)
    .map((s) =>
      make("new_subscription", "medium", 65, s.streamId, addDays(i.today, 30), {
        subject: s.streamId,
        facts: { ...streamFacts(i, s), amount: money(s.lastAmount) },
        template: { title: "New recurring charge: {{merchant}}", body: "{{merchant}} has started charging {{amount}} {{frequency}}." },
      }),
    );
}

export function priceIncreaseCandidates(i: DetectorInputs): Candidate[] {
  return i.streams
    .filter(isLiveOutflow)
    .filter((s) => s.status !== "EARLY_DETECTION")
    .flatMap((s) => {
      const last = Math.abs(s.lastAmount);
      const avg = Math.abs(s.averageAmount);
      const increase = roundMoney(last - avg);
      if (avg <= 0 || increase < Math.max(1, avg * 0.05)) return [];
      return [
        make("price_increase", "medium", 70, `${s.streamId}:${last.toFixed(2)}`, addDays(i.today, 30), {
          subject: s.streamId,
          facts: { ...streamFacts(i, s), newAmount: money(last), oldAmount: money(avg), increase: money(increase) },
          template: { title: "{{merchant}} went up", body: "{{merchant}} charged {{newAmount}} last time, up {{increase}} from its usual {{oldAmount}}." },
        }),
      ];
    });
}

export function billDueCandidates(i: DetectorInputs): Candidate[] {
  const horizon = addDays(i.today, BILL_HORIZON_DAYS).getTime();
  return i.streams
    .filter(isLiveOutflow)
    .filter((s) => s.predictedNextDate && s.predictedNextDate >= i.today && s.predictedNextDate.getTime() <= horizon)
    .filter((s) => Math.abs(s.lastAmount) >= 10)
    .map((s) => {
      const due = s.predictedNextDate!;
      const amount = Math.abs(s.lastAmount);
      const soon = due.getTime() - i.today.getTime() <= 3 * DAY_MS;
      const big = amount >= 500;
      return make("bill_due", big ? "medium" : "low", 50 + (big ? 10 : 0) + (big && soon ? 10 : 0), `${s.streamId}:${toDateParam(due)}`, addDays(due, 1), {
        subject: s.streamId,
        facts: { ...streamFacts(i, s), amount: money(amount), dueDate: date(due) },
        template: { title: "{{merchant}} is due {{dueDate}}", body: "Expect about {{amount}} from {{merchant}} on {{dueDate}}." },
      });
    });
}

// ---------------------------------------------------------------------------
// Budgets and safe-to-spend
// ---------------------------------------------------------------------------

export function budgetPaceCandidates(i: DetectorInputs): Candidate[] {
  return i.budgets.flatMap((b) => {
    if (b.window.state !== "active" || b.budgeted <= 0) return [];
    const start = new Date(`${b.window.start}T00:00:00Z`);
    const end = new Date(`${b.window.end}T00:00:00Z`);
    const totalDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    const elapsed = Math.max(1, totalDays - b.window.daysLeft + 1);
    const used = b.spent / b.budgeted;
    const expiresAt = addDays(end, 1);
    const base = {
      budget: text(b.categoryLabel),
      spent: money(b.spent),
      budgeted: money(b.budgeted),
      window: text(b.window.label),
    };
    if (b.spent > b.budgeted) {
      return [
        make("budget_pace", "high", 75, `${b.budgetId}:${b.window.start}:over`, expiresAt, {
          subject: `budget:${b.budgetId}`,
          facts: { ...base, over: money(b.spent - b.budgeted) },
          template: { title: "{{budget}} budget is over", body: "You've spent {{spent}} against a {{budgeted}} {{budget}} budget for {{window}}, {{over}} over." },
        }),
      ];
    }
    const elapsedShare = elapsed / totalDays;
    if (totalDays < 7 || used < 0.5 || used < elapsedShare + 0.2) return [];
    const projected = roundMoney(b.spent / elapsedShare);
    return [
      make("budget_pace", "medium", 60, `${b.budgetId}:${b.window.start}:ahead`, expiresAt, {
        subject: `budget:${b.budgetId}`,
        facts: { ...base, daysLeft: count(b.window.daysLeft), projected: money(projected) },
        template: {
          title: "{{budget}} budget is running fast",
          body: "{{spent}} of {{budgeted}} is spent with {{daysLeft}} days left; at this pace {{budget}} ends near {{projected}}.",
        },
      }),
    ];
  });
}

export function safeToSpendCandidates(i: DetectorInputs): Candidate[] {
  const s = i.safeToSpend;
  if (!s) return [];
  const key = toDateParam(s.through);
  const expiresAt = addDays(s.through, 1);
  if (s.safeToSpendCents < 0) {
    return [
      make("safe_to_spend", "high", 85, `${key}:short`, expiresAt, {
        subject: "safe_to_spend",
        facts: { bills: money(s.billsCents / 100), shortfall: money(-s.safeToSpendCents / 100), through: date(s.through) },
        template: {
          title: "Bills may outrun cash before {{through}}",
          body: "Upcoming bills and card payments of {{bills}} exceed your available cash by {{shortfall}} through {{through}}.",
        },
      }),
    ];
  }
  if (s.safeToSpendCents < SMALL_BASE_THRESHOLD * 2 * 100) {
    return [
      make("safe_to_spend", "medium", 65, `${key}:low`, expiresAt, {
        subject: "safe_to_spend",
        facts: { safe: money(s.safeToSpendCents / 100), through: date(s.through) },
        template: { title: "Money is tight until {{through}}", body: "After upcoming bills, only {{safe}} is safe to spend through {{through}}." },
      }),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// All of them
// ---------------------------------------------------------------------------

export function detectCandidates(i: DetectorInputs): Candidate[] {
  return [
    ...anomalyCandidates(i),
    ...driftCandidates(i),
    ...paceCandidates(i),
    ...deltaCandidates(i),
    ...newSubscriptionCandidates(i),
    ...priceIncreaseCandidates(i),
    ...billDueCandidates(i),
    ...budgetPaceCandidates(i),
    ...safeToSpendCandidates(i),
  ];
}

/**
 * What the digest may consider: over the threshold, one per subject (a new
 * subscription that also went up is one finding), highest score first.
 */
export function selectForDigest<T extends Pick<Candidate, "score" | "payload">>(
  candidates: T[],
  max = MAX_DIGEST_CANDIDATES,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (c.score < DIGEST_SCORE_THRESHOLD || seen.has(c.payload.subject)) continue;
    seen.add(c.payload.subject);
    out.push(c);
  }
  return out.slice(0, max);
}
