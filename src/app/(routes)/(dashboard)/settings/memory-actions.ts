"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { createMemory, deleteMemory, updateMemory, type MemoryWriteResult } from "@/lib/chat/memories";
import { logError } from "@/lib/logging";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const memoryId = z.string().trim().min(1).max(64);
const CreateInput = z.object({ content: z.string().max(2_000) });
const UpdateInput = z.object({ memoryId, content: z.string().max(2_000) });
const DeleteInput = z.object({ memoryId });

function toResult(res: MemoryWriteResult): ActionResult<{ id: string }> {
  return res.ok ? { success: true, data: { id: res.id } } : { success: false, error: res.message };
}

function revalidateMemoryPages() {
  revalidatePath("/settings");
  revalidatePath("/assistant");
}

/**
 * Save a memory. Also the apply step of a confirmed "save a memory" chat
 * proposal (source "chat"); the content is re-validated either way.
 */
export async function createMemoryAction(
  input: z.input<typeof CreateInput>,
  source: "manual" | "chat" = "manual",
): Promise<ActionResult<{ id: string }>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = CreateInput.safeParse(input);
  const from = z.enum(["manual", "chat"]).safeParse(source);
  if (!parsed.success || !from.success) return { success: false, error: "Invalid request" };

  try {
    const res = await createMemory(userId, parsed.data.content, from.data);
    if (res.ok) revalidateMemoryPages();
    return toResult(res);
  } catch (error) {
    logError("memories.create_failed", error, { userId });
    return { success: false, error: "Could not save that memory. Please try again." };
  }
}

export async function updateMemoryAction(input: z.input<typeof UpdateInput>): Promise<ActionResult<{ id: string }>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  try {
    const res = await updateMemory(userId, parsed.data.memoryId, parsed.data.content);
    if (res.ok) revalidateMemoryPages();
    return toResult(res);
  } catch (error) {
    logError("memories.update_failed", error, { userId });
    return { success: false, error: "Could not save that memory. Please try again." };
  }
}

export async function deleteMemoryAction(input: z.input<typeof DeleteInput>): Promise<ActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;
  const parsed = DeleteInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request" };

  try {
    if (!(await deleteMemory(userId, parsed.data.memoryId))) return { success: false, error: "Memory not found" };
  } catch (error) {
    logError("memories.delete_failed", error, { userId });
    return { success: false, error: "Could not delete that memory. Please try again." };
  }
  revalidateMemoryPages();
  return { success: true, data: null };
}
