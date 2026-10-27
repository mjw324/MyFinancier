"use server";

/**
 * The apply step of the assistant's confirm-to-apply proposals
 * (lib/chat/proposals.ts). A card names a proposal by chat and tool call id;
 * the proposal itself is read from the session user's stored transcript,
 * checked again against their data, and applied through the same code the
 * app's own pages use. The model never reaches this code.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import {
  applyRecategorize,
  checkProposal,
  findPendingProposal,
  type BudgetProposalInput,
  type ProposalPreview,
  type RecategorizeInput,
} from "@/lib/chat/proposals";
import { CHAT_ID_RE } from "@/lib/chat/store";
import { getUserToday } from "@/lib/utils/user-time";
import { toDateParam } from "@/lib/utils/date-ranges";
import { logError } from "@/lib/logging";
import { createBudgetAction } from "../budgets/actions";
import { createMemoryAction } from "../settings/memory-actions";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const ProposalRef = z.object({
  chatId: z.string().regex(CHAT_ID_RE),
  toolCallId: z.string().min(1).max(200),
});

const GONE = "This suggestion is no longer waiting for an answer.";

/** What the approval card shows, computed from the user's own rows. */
export async function previewProposalAction(input: z.input<typeof ProposalRef>): Promise<ActionResult<ProposalPreview>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = ProposalRef.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  const proposal = await findPendingProposal(userId, parsed.data.chatId, parsed.data.toolCallId);
  if (!proposal) return { success: false, error: GONE };
  const check = await checkProposal(userId, proposal.kind, proposal.input, await getUserToday());
  return check.ok ? { success: true, data: check.preview } : { success: false, error: check.reason };
}

/** Apply a proposal the user approved. Returns the approval id to answer the chat with. */
export async function applyProposalAction(input: z.input<typeof ProposalRef>): Promise<ActionResult<{ approvalId: string }>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = ProposalRef.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  const proposal = await findPendingProposal(userId, parsed.data.chatId, parsed.data.toolCallId);
  if (!proposal) return { success: false, error: GONE };
  const today = await getUserToday();
  const check = await checkProposal(userId, proposal.kind, proposal.input, today);
  if (!check.ok) return { success: false, error: check.reason };

  try {
    switch (proposal.kind) {
      case "proposeRecategorize": {
        await applyRecategorize(userId, proposal.input as RecategorizeInput);
        revalidatePath("/transactions");
        revalidatePath("/dashboard");
        revalidatePath("/budgets");
        break;
      }
      case "proposeBudget": {
        const b = proposal.input as BudgetProposalInput;
        const res = await createBudgetAction({
          categoryKey: b.categoryKey,
          amount: b.amount,
          period: b.period,
          startDate: toDateParam(today),
          endDate: null,
        });
        if (!res.success) return res;
        break;
      }
      case "proposeMemory": {
        const res = await createMemoryAction({ content: (proposal.input as { content: string }).content }, "chat");
        if (!res.success) return res;
        break;
      }
    }
  } catch (error) {
    logError("chat.proposal_apply_failed", error, { userId, kind: proposal.kind });
    return { success: false, error: "Could not apply that. Please try again." };
  }
  return { success: true, data: { approvalId: proposal.approvalId } };
}
