/**
 * Memory Server Actions: userId comes from the session, input is zod
 * validated, and update/delete only touch the session user's rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../setup/pglite";
import { makeUser } from "../setup/factories";
import { user } from "@/lib/db/schema/auth";
import { createMemory, listMemories } from "@/lib/chat/memories";

const session = vi.hoisted(() => ({ userId: "mem_a" as string | null }));
vi.mock("@/lib/auth/get-session", () => ({
  getServerSession: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createMemoryAction, deleteMemoryAction, updateMemoryAction } from "@/app/(routes)/(dashboard)/settings/memory-actions";

const A = "mem_a";
const B = "mem_b";

beforeEach(async () => {
  session.userId = A;
  await getTestDb().insert(user).values([makeUser({ id: A, email: "a@test.local" }), makeUser({ id: B, email: "b@test.local" })]);
});

describe("memory actions", () => {
  it("creates for the session user and reports validation errors", async () => {
    expect(await createMemoryAction({ content: "Saving for a car" })).toMatchObject({ success: true });
    expect(await createMemoryAction({ content: "http://x.example" })).toEqual({ success: false, error: "Memories can't contain links" });
    expect(await createMemoryAction({ content: "x" }, "rule" as never)).toEqual({ success: false, error: "Invalid request" });
    expect((await listMemories(A)).map((m) => [m.content, m.source])).toEqual([["Saving for a car", "manual"]]);
    expect(await listMemories(B)).toEqual([]);
  });

  it("refuses to edit or delete another user's memory", async () => {
    const theirs = await createMemory(B, "B's note", "manual");
    if (!theirs.ok) throw new Error("setup");
    expect(await updateMemoryAction({ memoryId: theirs.id, content: "mine now" })).toEqual({ success: false, error: "Memory not found" });
    expect(await deleteMemoryAction({ memoryId: theirs.id })).toEqual({ success: false, error: "Memory not found" });
    expect((await listMemories(B)).map((m) => m.content)).toEqual(["B's note"]);
  });

  it("requires a session", async () => {
    session.userId = null;
    expect(await createMemoryAction({ content: "x" })).toEqual({ success: false, error: "Unauthorized" });
  });
});
