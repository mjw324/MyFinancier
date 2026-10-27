import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * One row per model call. Holds counts and cost only — never prompts,
 * completions or tool results, which contain financial data.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // e.g. "digest", "categorize", "chat"
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("ai_usage_user_created_idx").on(table.userId, table.createdAt)],
).enableRLS();

/** Fixed-window request counters for AI endpoints (see lib/ai/rate-limit.ts). */
export const aiRateLimits = pgTable(
  "ai_rate_limits",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { mode: "date" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.bucket, table.windowStart] })],
).enableRLS();

export type AiUsage = typeof aiUsage.$inferSelect;

/**
 * Chat assistant conversations. Transcripts expire 90 days after their last
 * activity (purgeExpiredChats) and cascade with the user, so account deletion
 * removes them. Never logged.
 */
export const aiChat = pgTable(
  "ai_chat",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("ai_chat_user_updated_idx").on(table.userId, table.updatedAt)],
).enableRLS();

/**
 * One AI SDK UIMessage per row, `parts` stored whole as jsonb and validated
 * with validateUIMessages on load. Keyed by (chat, message id) so a client
 * supplied id can never reach another chat's rows.
 */
export const aiMessage = pgTable(
  "ai_message",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => aiChat.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.id] }),
    index("ai_message_chat_position_idx").on(table.chatId, table.position),
    index("ai_message_created_idx").on(table.createdAt),
  ],
).enableRLS();

export type AiChat = typeof aiChat.$inferSelect;
export type AiMessageRow = typeof aiMessage.$inferSelect;
