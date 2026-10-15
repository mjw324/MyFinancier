/**
 * Client-safe flow-class options for override controls.
 *
 * `./flow.ts` builds SQL with drizzle at module load, so importing it into a
 * client component would ship the ORM and the schema to the browser. This
 * module has only a type import from it. Its labels must equal
 * FLOW_CLASS_LABEL (enforced by tests/unit/flow-options.test.ts).
 */
import type { FlowClass } from "./flow";

export const FLOW_CLASS_OPTION_LABEL: Record<FlowClass, string> = {
  income: "Income",
  other_inflow: "Other money in",
  spending: "Spending",
  debt_payment: "Debt payment",
  cash_withdrawal: "Cash withdrawal",
  p2p_payment: "Sent to someone",
  refund: "Refund",
  reimbursement: "Reimbursement",
  card_reward: "Reward / cashback",
  savings_out: "Saved / invested",
  savings_in: "Withdrawn from savings",
  external_transfer_out: "Moved to your other account",
  external_transfer_in: "From your other account",
  cc_payment: "Card payment",
  internal_transfer: "Transfer between your accounts",
  zero: "Zero amount",
};

/** Classes a user may pick for money leaving an account (amount > 0). */
export const OUTFLOW_FLOW_CLASSES: readonly FlowClass[] = [
  "spending",
  "debt_payment",
  "cash_withdrawal",
  "p2p_payment",
  "savings_out",
  "external_transfer_out",
  "cc_payment",
  "internal_transfer",
];

/** Classes a user may pick for money entering an account (amount < 0). */
export const INFLOW_FLOW_CLASSES: readonly FlowClass[] = [
  "income",
  "other_inflow",
  "refund",
  "reimbursement",
  "card_reward",
  "savings_in",
  "external_transfer_in",
  "cc_payment",
  "internal_transfer",
];

/** The classes that make sense for a transaction of this signed amount. */
export function allowedFlowClasses(amount: number | string): readonly FlowClass[] {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n) || n === 0) return [];
  return n > 0 ? OUTFLOW_FLOW_CLASSES : INFLOW_FLOW_CLASSES;
}

export function flowClassOptionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return (FLOW_CLASS_OPTION_LABEL as Record<string, string>)[value] ?? null;
}
