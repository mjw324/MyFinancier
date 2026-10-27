import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import { getTestDb } from "../setup/pglite";
import { makeUser } from "../setup/factories";
import { user } from "@/lib/db/schema/auth";
import { aiChat, aiMessage } from "@/lib/db/schema/ai";
import {
  claimChat,
  loadChatMessages,
  purgeExpiredChats,
  saveChatMessages,
} from "@/lib/chat/store";

const U = "u_chat";
const OTHER = "u_other";
const CHAT = "chat_abcdef01";

const msg = (id: string, role: UIMessage["role"], text: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

beforeEach(async () => {
  await getTestDb().insert(user).values([makeUser({ id: U }), makeUser({ id: OTHER })]);
});

describe("chat store", () => {
  it("claims a new chat once and refuses another user's chat id", async () => {
    expect(await claimChat(U, CHAT)).toBe(true);
    expect(await claimChat(U, CHAT)).toBe(true);
    expect(await claimChat(OTHER, CHAT)).toBe(false);
    expect(await claimChat(U, "bad id!")).toBe(false);
  });

  it("round-trips UIMessage parts in order and re-saves idempotently", async () => {
    await claimChat(U, CHAT);
    const turn = [msg("m1", "user", "hi"), msg("m2", "assistant", "hello")];
    await saveChatMessages(U, CHAT, turn);
    await saveChatMessages(U, CHAT, [...turn, msg("m3", "user", "more")]);
    const loaded = await loadChatMessages(U, CHAT);
    expect(loaded.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(loaded[1].parts).toEqual([{ type: "text", text: "hello" }]);
  });

  it("never reads or writes another user's transcript", async () => {
    await claimChat(U, CHAT);
    await saveChatMessages(U, CHAT, [msg("m1", "user", "mine")]);
    await saveChatMessages(OTHER, CHAT, [msg("m1", "user", "overwritten")]);
    expect(await loadChatMessages(OTHER, CHAT)).toEqual([]);
    expect((await loadChatMessages(U, CHAT))[0].parts).toEqual([{ type: "text", text: "mine" }]);
  });

  it("expires transcripts after 90 days", async () => {
    const old = new Date("2026-06-01T00:00:00Z");
    const now = new Date("2026-10-27T00:00:00Z");
    await claimChat(U, CHAT, old);
    await saveChatMessages(U, CHAT, [msg("m1", "user", "old")], old);
    await claimChat(U, "chat_recent01", now);
    await saveChatMessages(U, "chat_recent01", [msg("m1", "user", "new")], now);

    expect(await purgeExpiredChats(now)).toEqual({ messages: 1, chats: 1 });
    expect(await loadChatMessages(U, "chat_recent01")).toHaveLength(1);
    expect(await getTestDb().select().from(aiChat).where(eq(aiChat.id, CHAT))).toEqual([]);
  });

  it("is deleted with the user (account deletion)", async () => {
    await claimChat(U, CHAT);
    await saveChatMessages(U, CHAT, [msg("m1", "user", "hi")]);
    await getTestDb().delete(user).where(eq(user.id, U));
    expect(await getTestDb().select().from(aiMessage)).toEqual([]);
    expect(await getTestDb().select().from(aiChat)).toEqual([]);
  });
});
