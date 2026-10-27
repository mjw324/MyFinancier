"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { setAiOptIn } from "@/lib/ai/consent";
import { logError } from "@/lib/logging";

/** Turn AI insights on (recording consent version and time) or off. */
export async function updateAiOptInAction(
  optIn: boolean,
): Promise<{ success: true; data: { optIn: boolean } } | { success: false; error: string }> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  const parsed = z.boolean().safeParse(optIn);
  if (!parsed.success) return { success: false, error: "Invalid choice" };

  try {
    await setAiOptIn(userId, parsed.data);
  } catch (error) {
    logError("preferences.ai_opt_in_failed", error, { userId });
    return { success: false, error: "Could not save your AI preference. Please try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { success: true, data: { optIn: parsed.data } };
}
