/**
 * Chat transcripts: one ai_chat row per conversation, one ai_message row per
 * AI SDK UIMessage with its parts as jsonb. Every function takes the session
 * user's id and scopes by it; a chat id that belongs to someone else behaves
 * as if it did not exist.
 *
 * Transcripts hold financial data: they are never logged, they expire
 * CHAT_RETENTION_DAYS after they were written (purgeExpiredChats, run by the
 * instrumentation sweep), and they cascade with the user.
 */

import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/lib/db";
import { aiChat, aiMessage } from "@/lib/db/schema/ai";

export const CHAT_RETENTION_DAYS = 90;
/** Messages kept per chat; the oldest drop off the front of the history sent to the model. */
export const MAX_HISTORY_MESSAGES = 40;

/** Chat ids come from the client: opaque, short, URL-safe. */
export const CHAT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Create the chat for this user if it is new. False when the id is taken by
 * another user's chat (the caller answers 404, never revealing which).
 */
export async function claimChat(userId: string, chatId: string, now: Date = new Date()): Promise<boolean> {
  if (!CHAT_ID_RE.test(chatId)) return false;
  await db.insert(aiChat).values({ id: chatId, userId, createdAt: now, updatedAt: now }).onConflictDoNothing();
  const [row] = await db.select({ userId: aiChat.userId }).from(aiChat).where(eq(aiChat.id, chatId)).limit(1);
  return row?.userId === userId;
}

/** Stored messages, oldest first. Callers validate them (validateUIMessages) before use. */
export async function loadChatMessages(userId: string, chatId: string): Promise<UIMessage[]> {
  const rows = await db
    .select({ id: aiMessage.id, role: aiMessage.role, parts: aiMessage.parts, metadata: aiMessage.metadata })
    .from(aiMessage)
    .where(and(eq(aiMessage.chatId, chatId), eq(aiMessage.userId, userId)))
    .orderBy(asc(aiMessage.position));
  return rows.map((r) => ({
    id: r.id,
    role: r.role as UIMessage["role"],
    parts: r.parts as UIMessage["parts"],
    ...(r.metadata ? { metadata: r.metadata } : {}),
  }));
}

/**
 * Save the full message list after a turn. Upserts by (chat, message id) with
 * the list position, so a re-save of the same turn is idempotent.
 */
export async function saveChatMessages(
  userId: string,
  chatId: string,
  messages: UIMessage[],
  now: Date = new Date(),
): Promise<void> {
  if (messages.length === 0) return;
  await db.transaction(async (tx) => {
    const [chat] = await tx
      .update(aiChat)
      .set({ updatedAt: now })
      .where(and(eq(aiChat.id, chatId), eq(aiChat.userId, userId)))
      .returning({ id: aiChat.id });
    if (!chat) return;
    await tx
      .insert(aiMessage)
      .values(
        messages.map((m, position) => ({
          chatId,
          id: m.id,
          userId,
          position,
          role: m.role,
          parts: m.parts,
          metadata: m.metadata ?? null,
          createdAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [aiMessage.chatId, aiMessage.id],
        set: {
          position: sql`excluded.position`,
          parts: sql`excluded.parts`,
          metadata: sql`excluded.metadata`,
        },
        // Never move a row between users, even if ids collide.
        setWhere: eq(aiMessage.userId, userId),
      });
  });
}

/** The user's chats, newest first, for the chat list. */
export async function listChats(userId: string, limit = 20) {
  return db
    .select({ id: aiChat.id, updatedAt: aiChat.updatedAt })
    .from(aiChat)
    .where(eq(aiChat.userId, userId))
    .orderBy(sql`${aiChat.updatedAt} DESC`)
    .limit(limit);
}

export async function deleteChat(userId: string, chatId: string): Promise<void> {
  await db.delete(aiChat).where(and(eq(aiChat.id, chatId), eq(aiChat.userId, userId)));
}

/**
 * Retention: messages older than CHAT_RETENTION_DAYS are deleted, then chats
 * with no activity in that window (their remaining messages cascade).
 */
export async function purgeExpiredChats(now: Date = new Date()): Promise<{ messages: number; chats: number }> {
  const cutoff = new Date(now.getTime() - CHAT_RETENTION_DAYS * 86_400_000);
  const messages = await db.delete(aiMessage).where(lt(aiMessage.createdAt, cutoff)).returning({ id: aiMessage.id });
  const chats = await db.delete(aiChat).where(lt(aiChat.updatedAt, cutoff)).returning({ id: aiChat.id });
  return { messages: messages.length, chats: chats.length };
}
