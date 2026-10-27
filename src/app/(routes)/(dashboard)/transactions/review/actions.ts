"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { suggestCategories } from "@/lib/categorize/suggest";
import { acceptSuggestion, rejectSuggestion } from "@/lib/categorize/review";
import { plaidPrimarySchema } from "@/lib/categorize/categories";
import { deleteCategoryRule, recomputeAfterCategoryChange } from "@/lib/categorize/rules";
import { logError } from "@/lib/logging";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

function revalidateCategoryPages() {
  revalidatePath("/transactions");
  revalidatePath("/transactions/review");
  revalidatePath("/dashboard");
  revalidatePath("/budgets");
}

/** "Suggest categories": one gated run of the suggestion job for this user. */
export async function requestCategorySuggestionsAction(): Promise<
  ActionResult<{ suggested: number; uncertain: number; ruled: number }>
> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  try {
    const res = await suggestCategories({ userId });
    revalidateCategoryPages();
    switch (res.status) {
      case "disabled":
        return { success: false, error: "Turn on AI features in Settings to get suggestions." };
      case "over_budget":
        return { success: false, error: "You've reached this month's AI limit. Suggestions resume on the 1st." };
      case "rate_limited":
        return { success: false, error: "That's a lot of requests. Please try again in a little while." };
      default:
        return { success: true, data: { suggested: res.suggested, uncertain: res.uncertain, ruled: res.ruled } };
    }
  } catch (error) {
    logError("categorize.suggest_failed", error, { userId });
    return { success: false, error: "Could not get suggestions. Please try again." };
  }
}

const AcceptInput = z.object({
  suggestionId: z.string().trim().min(1).max(64),
  category: plaidPrimarySchema,
  rememberForMerchant: z.boolean(),
});

export async function acceptCategorySuggestionAction(
  input: z.input<typeof AcceptInput>,
): Promise<ActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = AcceptInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  try {
    const res = await acceptSuggestion({ userId, ...parsed.data });
    if (!res.ok) {
      return {
        success: false,
        error: res.error === "already_categorized" ? "You already categorized this transaction." : "That suggestion no longer exists.",
      };
    }
  } catch (error) {
    logError("categorize.accept_failed", error, { userId });
    return { success: false, error: "Could not save that. Please try again." };
  }
  revalidateCategoryPages();
  return { success: true, data: null };
}

const RejectInput = z.object({ suggestionId: z.string().trim().min(1).max(64) });

export async function rejectCategorySuggestionAction(
  input: z.input<typeof RejectInput>,
): Promise<ActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = RejectInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  const res = await rejectSuggestion(userId, parsed.data.suggestionId);
  if (!res.ok) return { success: false, error: "That suggestion no longer exists." };
  revalidatePath("/transactions/review");
  return { success: true, data: null };
}

const DeleteRuleInput = z.object({ ruleId: z.string().trim().min(1).max(64) });

/** Delete a category rule; the rows it categorized go back to Plaid's category. */
export async function deleteCategoryRuleAction(
  input: z.input<typeof DeleteRuleInput>,
): Promise<ActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = DeleteRuleInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  try {
    const res = await deleteCategoryRule(userId, parsed.data.ruleId);
    if (!res.found) return { success: false, error: "Rule not found" };
    if (res.changedIds.length > 0) await recomputeAfterCategoryChange(userId, res.changedIds);
  } catch (error) {
    logError("categorize.delete_rule_failed", error, { userId });
    return { success: false, error: "Could not delete that rule. Please try again." };
  }
  revalidateCategoryPages();
  revalidatePath("/settings");
  return { success: true, data: null };
}
