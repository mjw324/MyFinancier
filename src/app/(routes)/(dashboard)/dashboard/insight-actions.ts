"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { setCandidateFeedback } from "@/lib/insights/jobs";
import { logError } from "@/lib/logging";

const FeedbackInput = z.object({
  id: z.string().trim().min(1).max(64),
  action: z.enum(["helpful", "not_helpful", "dismiss"]),
});

/** Helpful / not helpful / dismiss on one digest item the user owns. */
export async function insightFeedbackAction(
  input: z.input<typeof FeedbackInput>,
): Promise<{ success: true; data: null } | { success: false; error: string }> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  const parsed = FeedbackInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };
  const { id, action } = parsed.data;

  try {
    const updated = await setCandidateFeedback(
      userId,
      [id],
      action === "dismiss" ? { dismiss: true } : { helpful: action === "helpful" },
    );
    if (updated === 0) return { success: false, error: "That insight no longer exists." };
  } catch (error) {
    logError("insights.feedback_failed", error, { userId });
    return { success: false, error: "Could not save that. Please try again." };
  }

  if (action === "dismiss") revalidatePath("/dashboard");
  return { success: true, data: null };
}
