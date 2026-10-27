/**
 * Chat memories: short notes the user wants the assistant to keep in mind
 * ("I'm saving for a car", "rent is split with a roommate"). Every row is
 * written by the user, by hand in Settings or by confirming a chat proposal;
 * the model can only propose one (lib/chat/proposals.ts).
 *
 * A memory is still model input, and one that slipped in an instruction
 * would ride along in every later turn, so:
 * - content is normalized and validated on write (no links, length capped);
 * - proposals that read like instructions to the assistant are refused
 *   before the user is asked (looksLikeInstruction);
 * - the snapshot copy is cleaned again (cleanLabel), capped in count and in
 *   total size, and placed after the cache breakpoint as data.
 *
 * Every function takes the session user's id and scopes by it.
 */

import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { userMemories, type UserMemory } from "@/lib/db/schema/ai";
import { cleanLabel } from "@/lib/insights/sanitize";

export const MAX_MEMORIES = 20;
export const MAX_MEMORY_CHARS = 200;
/** Total characters of memories in one snapshot (about 500 tokens). */
export const MAX_SNAPSHOT_MEMORY_CHARS = 2_000;

export type MemorySource = "manual" | "chat";

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|ai|co|app|dev|xyz|ly)\b/i;
const CONTROL_RE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;

/** NFKC, control and invisible characters removed, whitespace collapsed. */
export function normalizeMemory(raw: string): string {
  return raw.normalize("NFKC").replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
}

export const MemoryContentSchema = z
  .string()
  .transform(normalizeMemory)
  .pipe(
    z
      .string()
      .min(1, "Write something to remember")
      .max(MAX_MEMORY_CHARS, `Memories are limited to ${MAX_MEMORY_CHARS} characters`)
      .refine((s) => !URL_RE.test(s), "Memories can't contain links"),
  );

const INSTRUCTION_RE =
  /\b(?:ignore|disregard|forget|override)\b.{0,40}\b(?:instructions?|rules?|prompts?|guidelines?|above|previous)\b|\b(?:system prompt|developer mode|jailbreak|you are now|act as|pretend to be|from now on,? you)\b|\b(?:assistant|ai|model)\s+(?:must|should|will)\b|\b(?:always|never)\s+(?:recommend|say|tell|answer|respond|reply|call|propose|approve)\b/i;

/**
 * A memory describes the person or their money. One that addresses the
 * assistant ("ignore your rules", "always recommend…") is an injection
 * attempt or a misuse, and is refused when the model proposes it.
 */
export function looksLikeInstruction(content: string): boolean {
  return INSTRUCTION_RE.test(normalizeMemory(content));
}

export async function listMemories(userId: string): Promise<UserMemory[]> {
  return db
    .select()
    .from(userMemories)
    .where(eq(userMemories.userId, userId))
    .orderBy(desc(userMemories.createdAt), desc(userMemories.id));
}

export type MemoryWriteResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid" | "limit" | "not_found"; message: string };

function invalid(error: z.ZodError): MemoryWriteResult {
  return { ok: false, error: "invalid", message: error.issues[0]?.message ?? "Invalid memory" };
}

export async function createMemory(
  userId: string,
  raw: string,
  source: MemorySource,
  now: Date = new Date(),
): Promise<MemoryWriteResult> {
  const parsed = MemoryContentSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const content = parsed.data;

  // Saving the same note twice is a no-op, not a second row.
  const [existing] = await db
    .select({ id: userMemories.id })
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.content, content)))
    .limit(1);
  if (existing) return { ok: true, id: existing.id };

  const [{ n }] = await db.select({ n: count() }).from(userMemories).where(eq(userMemories.userId, userId));
  if (n >= MAX_MEMORIES) {
    return { ok: false, error: "limit", message: `You can keep up to ${MAX_MEMORIES} memories. Delete one first.` };
  }
  const [row] = await db
    .insert(userMemories)
    .values({ userId, content, source, createdAt: now, updatedAt: now })
    .returning({ id: userMemories.id });
  return { ok: true, id: row.id };
}

export async function updateMemory(
  userId: string,
  id: string,
  raw: string,
  now: Date = new Date(),
): Promise<MemoryWriteResult> {
  const parsed = MemoryContentSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const updated = await db
    .update(userMemories)
    .set({ content: parsed.data, updatedAt: now })
    .where(and(eq(userMemories.id, id), eq(userMemories.userId, userId)))
    .returning({ id: userMemories.id });
  return updated.length > 0 ? { ok: true, id } : { ok: false, error: "not_found", message: "Memory not found" };
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(userMemories)
    .where(and(eq(userMemories.id, id), eq(userMemories.userId, userId)))
    .returning({ id: userMemories.id });
  return deleted.length > 0;
}

/** Whether this exact note (after normalization) is saved for the user. */
export async function hasMemory(userId: string, raw: string): Promise<boolean> {
  const content = normalizeMemory(raw);
  const [row] = await db
    .select({ id: userMemories.id })
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.content, content)))
    .limit(1);
  return !!row;
}

/**
 * The snapshot copy: newest first, each cleaned like any other model-bound
 * text, stopping before MAX_SNAPSHOT_MEMORY_CHARS.
 */
export function memoriesForSnapshot(rows: Array<Pick<UserMemory, "content">>): { notes: string[]; truncated: boolean } {
  const notes: string[] = [];
  let used = 0;
  for (const row of rows.slice(0, MAX_MEMORIES)) {
    const note = cleanLabel(row.content, MAX_MEMORY_CHARS);
    if (!note) continue;
    if (used + note.length > MAX_SNAPSHOT_MEMORY_CHARS) return { notes, truncated: true };
    notes.push(note);
    used += note.length;
  }
  return { notes, truncated: rows.length > notes.length };
}
