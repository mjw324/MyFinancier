"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { CHAT_ID_RE, deleteChat } from "@/lib/chat/store";
import { logError } from "@/lib/logging";

const DeleteChatInput = z.object({ chatId: z.string().regex(CHAT_ID_RE) });

/** Delete one of the session user's chats (and its messages). */
export async function deleteChatAction(
  input: z.input<typeof DeleteChatInput>,
): Promise<{ success: true; data: null } | { success: false; error: string }> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const parsed = DeleteChatInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };
  try {
    await deleteChat(session.user.id, parsed.data.chatId);
    revalidatePath("/assistant");
    return { success: true, data: null };
  } catch (error) {
    logError("chat.delete_failed", error, { userId: session.user.id });
    return { success: false, error: "Could not delete this chat. Please try again." };
  }
}
