/**
 * Confirm-to-apply proposals: the only way the chat assistant can lead to a
 * change. The model calls a propose* tool; AI SDK tool approvals hold the
 * call and the UI shows an approval card; nothing is written until the user
 * presses Apply, which runs an ordinary Server Action
 * (app/(routes)/(dashboard)/assistant/proposal-actions.ts) with userId from
 * the session.
 *
 * Three layers, each re-checking the last:
 * 1. proposalApproval (toolApproval on streamText): checkProposal runs before
 *    the user is asked. An id that isn't the user's, an unknown category or
 *    a memory that reads like an instruction is denied automatically, with
 *    a reason the model sees, and no card is shown.
 * 2. The Server Action loads the proposal from the stored transcript (never
 *    from the client), runs checkProposal again and applies it through the
 *    same code paths the app's own pages use.
 * 3. The tool's execute runs only after the user approved, and writes
 *    nothing: proposalOutcome reads back whether the change is in place, so
 *    a forged approval changes nothing and the model reports what is true.
 *
 * Proposals cover categories, budgets and memories only. Nothing here moves
 * money, touches Plaid connections or sends anything.
 */

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { budgets, BUDGET_PERIODS } from "@/lib/db/schema/budgets";
import { transactions } from "@/lib/db/schema/transactions";
import { isAllowedBudgetKey } from "@/lib/db/queries/categories";
import { findOverlappingBudget } from "@/lib/db/queries/budgets";
import { spendBucketLabel } from "@/lib/budgets/categories";
import { PLAID_PRIMARIES, plaidPrimarySchema } from "@/lib/categorize/categories";
import { recomputeAfterCategoryChange } from "@/lib/categorize/rules";
import { cleanLabel } from "@/lib/insights/sanitize";
import { displayName, formatCategory } from "@/lib/utils/format";
import { toDateParam } from "@/lib/utils/date-ranges";
import { loadChatMessages } from "./store";
import { hasMemory, listMemories, looksLikeInstruction, MAX_MEMORIES, MemoryContentSchema } from "./memories";
import { money, type Money } from "./values";

export const MAX_RECATEGORIZE = 25;
export const MAX_PROPOSED_BUDGET = 10_000_000;

export const RecategorizeInputSchema = z
  .object({
    transactionIds: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(MAX_RECATEGORIZE)
      .describe("Transaction ids from searchTransactions"),
    category: plaidPrimarySchema.describe("The new category"),
  })
  .strict();

export const BudgetInputSchema = z
  .object({
    categoryKey: z
      .string()
      .min(1)
      .max(100)
      .describe("A spending category key such as FOOD_AND_DRINK or GENERAL_MERCHANDISE, or one of the person's own category names"),
    amount: z.number().positive().max(MAX_PROPOSED_BUDGET).describe("Dollars per period"),
    period: z.enum(BUDGET_PERIODS),
  })
  .strict();

export const MemoryInputSchema = z
  .object({ content: z.string().min(1).max(200).describe("One short note in the person's own terms") })
  .strict();

export type RecategorizeInput = z.infer<typeof RecategorizeInputSchema>;
export type BudgetProposalInput = z.infer<typeof BudgetInputSchema>;
export type MemoryProposalInput = z.infer<typeof MemoryInputSchema>;

export const PROPOSAL_TOOLS = {
  proposeRecategorize: RecategorizeInputSchema,
  proposeBudget: BudgetInputSchema,
  proposeMemory: MemoryInputSchema,
} as const;
export type ProposalToolName = keyof typeof PROPOSAL_TOOLS;
export const PROPOSAL_TOOL_NAMES = Object.keys(PROPOSAL_TOOLS) as ProposalToolName[];

export function isProposalTool(name: string): name is ProposalToolName {
  return name in PROPOSAL_TOOLS;
}

/** What the approval card shows: built server-side from the user's own rows. */
export type ProposalPreview =
  | {
      kind: "proposeRecategorize";
      category: { key: string; label: string };
      transactions: Array<{ id: string; date: string; label: string; amount: Money; direction: "in" | "out"; category: string }>;
    }
  | { kind: "proposeBudget"; categoryKey: string; categoryLabel: string; amount: Money; period: string; startDate: string }
  | { kind: "proposeMemory"; content: string };

export type ProposalCheck = { ok: true; preview: ProposalPreview } | { ok: false; reason: string };

const fail = (reason: string): ProposalCheck => ({ ok: false, reason });

/**
 * Validate a proposal for this user: schema, ownership and the same rules
 * the app's own forms apply. `today` is the user's calendar date (a new
 * budget starts then).
 */
export async function checkProposal(userId: string, kind: string, rawInput: unknown, today: Date): Promise<ProposalCheck> {
  if (!isProposalTool(kind)) return fail("Unknown proposal.");
  const parsed = PROPOSAL_TOOLS[kind].safeParse(rawInput);
  if (!parsed.success) return fail("The proposal's details are not valid.");

  switch (kind) {
    case "proposeRecategorize": {
      const input = parsed.data as RecategorizeInput;
      const ids = [...new Set(input.transactionIds)];
      const rows = await db
        .select({
          id: transactions.id,
          date: transactions.date,
          amount: transactions.amount,
          name: transactions.name,
          merchantName: transactions.merchantName,
          customName: transactions.customName,
          category: transactions.category,
          customCategory: transactions.customCategory,
        })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)));
      if (rows.length !== ids.length) {
        return fail("Some of those transactions don't exist in this person's accounts. Use ids returned by searchTransactions.");
      }
      const order = new Map(ids.map((id, i) => [id, i]));
      rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      return {
        ok: true,
        preview: {
          kind,
          category: { key: input.category, label: formatCategory(input.category) },
          transactions: rows.map((t) => {
            const amount = Number(t.amount);
            return {
              id: t.id,
              date: toDateParam(t.date),
              label: cleanLabel(displayName({ customName: t.customName, merchantName: t.merchantName, fallback: t.name }), 64) || "Unknown",
              amount: money(Math.abs(amount)),
              direction: amount >= 0 ? ("out" as const) : ("in" as const),
              category: formatCategory(t.customCategory ?? t.category ?? "UNCATEGORIZED"),
            };
          }),
        },
      };
    }
    case "proposeBudget": {
      const input = parsed.data as BudgetProposalInput;
      if (!(await isAllowedBudgetKey(userId, input.categoryKey))) {
        return fail(`"${cleanLabel(input.categoryKey, 40)}" is not one of this person's budget categories.`);
      }
      const amount = Math.round(input.amount * 100) / 100;
      if (amount < 0.01) return fail("The amount must be at least $0.01.");
      const overlap = await findOverlappingBudget(userId, {
        categoryKey: input.categoryKey,
        period: input.period,
        startDate: today,
        endDate: null,
      });
      if (overlap) return fail(`There is already a ${input.period} budget for that category. Suggest changing it on the Budgets page instead.`);
      return {
        ok: true,
        preview: {
          kind,
          categoryKey: input.categoryKey,
          categoryLabel: cleanLabel(spendBucketLabel(input.categoryKey), 60),
          amount: money(amount),
          period: input.period,
          startDate: toDateParam(today),
        },
      };
    }
    case "proposeMemory": {
      const content = MemoryContentSchema.safeParse((parsed.data as MemoryProposalInput).content);
      if (!content.success) return fail(content.error.issues[0]?.message ?? "That note can't be saved.");
      if (looksLikeInstruction(content.data)) {
        return fail("Memories describe the person and their money; they can't contain instructions to the assistant.");
      }
      if (!(await hasMemory(userId, content.data)) && (await listMemories(userId)).length >= MAX_MEMORIES) {
        return fail(`This person already has ${MAX_MEMORIES} memories. They can delete one in Settings.`);
      }
      return { ok: true, preview: { kind, content: content.data } };
    }
  }
}

/**
 * Apply a checked recategorize proposal: the user's own rows only, marked as
 * a manual choice (category rules never overwrite it), then flows and
 * spending types are recomputed as for any category edit.
 */
export async function applyRecategorize(userId: string, input: RecategorizeInput): Promise<{ changed: number }> {
  const ids = [...new Set(input.transactionIds)];
  const updated = await db
    .update(transactions)
    .set({ customCategory: input.category, customCategorySource: "manual" })
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)))
    .returning({ id: transactions.id });
  const changed = updated.map((r) => r.id);
  if (changed.length > 0) await recomputeAfterCategoryChange(userId, changed);
  return { changed: changed.length };
}

/**
 * What the tool reports after the user approved: whether the change is in
 * place. Read-only; the write happened (or didn't) in the Server Action.
 */
/**
 * Read back after an approval. The continuation's snapshot is rebuilt after
 * the change was applied, so an applied result says so (CHAT_INSTRUCTIONS
 * explains the flag): otherwise the model reads the new budget or note in
 * the snapshot as an older duplicate.
 */
export async function proposalOutcome(userId: string, kind: ProposalToolName, rawInput: unknown) {
  const outcome = await readOutcome(userId, kind, rawInput);
  return outcome.status === "applied" ? { ...outcome, inSnapshot: true } : outcome;
}

async function readOutcome(userId: string, kind: ProposalToolName, rawInput: unknown) {
  switch (kind) {
    case "proposeRecategorize": {
      const input = RecategorizeInputSchema.parse(rawInput);
      const ids = [...new Set(input.transactionIds)];
      const rows = await db
        .select({ id: transactions.id, customCategory: transactions.customCategory })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)));
      const done = rows.filter((r) => r.customCategory === input.category).length;
      return {
        status: done === ids.length ? ("applied" as const) : ("not_applied" as const),
        category: formatCategory(input.category),
        recategorized: done,
        requested: ids.length,
      };
    }
    case "proposeBudget": {
      const input = BudgetInputSchema.parse(rawInput);
      const [row] = await db
        .select({ amount: budgets.amount })
        .from(budgets)
        .where(and(eq(budgets.userId, userId), eq(budgets.categoryKey, input.categoryKey), eq(budgets.period, input.period)))
        .limit(1);
      return {
        status: row ? ("applied" as const) : ("not_applied" as const),
        category: spendBucketLabel(input.categoryKey),
        period: input.period,
        amount: row ? money(Number(row.amount)) : null,
      };
    }
    case "proposeMemory": {
      const input = MemoryInputSchema.parse(rawInput);
      return { status: (await hasMemory(userId, input.content)) ? ("applied" as const) : ("not_applied" as const) };
    }
  }
}

export interface PendingProposal {
  kind: ProposalToolName;
  input: unknown;
  approvalId: string;
}

/**
 * The proposal a card refers to, read from the user's stored transcript:
 * a propose* part of the chat's last message that is still waiting for the
 * user. The client names it by id only; its input never comes from the
 * client.
 */
export async function findPendingProposal(userId: string, chatId: string, toolCallId: string): Promise<PendingProposal | null> {
  const messages = await loadChatMessages(userId, chatId);
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return null;
  for (const part of last.parts as Array<Record<string, unknown>>) {
    const kind = typeof part.type === "string" ? part.type.replace(/^tool-/, "") : "";
    const approval = part.approval as { id?: unknown; isAutomatic?: unknown } | undefined;
    if (
      part.toolCallId === toolCallId &&
      isProposalTool(kind) &&
      part.state === "approval-requested" &&
      typeof approval?.id === "string" &&
      approval.isAutomatic !== true
    ) {
      return { kind, input: part.input, approvalId: approval.id };
    }
  }
  return null;
}

/** For the tool description: the categories proposeRecategorize accepts. */
export const RECATEGORIZE_CATEGORIES = PLAID_PRIMARIES.join(", ");
