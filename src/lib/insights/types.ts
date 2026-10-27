/**
 * Insight candidates: findings computed in code, which the weekly digest may
 * rank and phrase. Pure types (the schema imports them).
 */

export type CandidateType =
  | "anomaly"
  | "drift"
  | "pace"
  | "delta"
  | "new_subscription"
  | "price_increase"
  | "bill_due"
  | "budget_pace"
  | "safe_to_spend";

export type Severity = "low" | "medium" | "high";

export type FactKind = "money" | "percent" | "date" | "count" | "text";

/**
 * One figure or label a sentence may mention. The model writes `{{key}}`;
 * rendering replaces it with `display`. `modelDisplay` is what the model is
 * shown instead, when the user-facing text must not leave the app (a P2P
 * counterparty's name becomes a stable token).
 */
export interface Fact {
  kind: FactKind;
  /** Exact value (dollars for money, a ratio for percent, YYYY-MM-DD for date). */
  value: number | string;
  display: string;
  modelDisplay?: string;
}

export interface CandidatePayload {
  /** A bucket key, stream id or the finding kind: one finding per subject. */
  subject: string;
  facts: Record<string, Fact>;
  /** Deterministic wording with placeholders, used when model text fails checks. */
  template: { title: string; body: string };
  href?: string;
}

export interface Candidate {
  type: CandidateType;
  severity: Severity;
  /** 0–100, higher first. */
  score: number;
  fingerprint: string;
  expiresAt: Date;
  payload: CandidatePayload;
}
