import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import type { CandidatePayload } from "@/lib/insights/types";

/**
 * Findings computed in plain code (src/lib/insights/detectors.ts). The weekly
 * digest asks the model to rank and phrase a few of them; every figure it
 * shows comes from `payload`, never from model output.
 *
 * `fingerprint` dedupes across runs (e.g. "price_increase:<stream>:22.99"):
 * a finding the user dismissed stays dismissed when it is detected again.
 * `title`/`body` hold the rendered digest text (placeholders already filled
 * from the payload) once the finding made it into a digest.
 */
export const insightCandidates = pgTable(
  "insight_candidates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    // "low" | "medium" | "high"
    severity: text("severity").notNull(),
    // 0–100; candidates under the digest threshold never reach the model.
    score: integer("score").notNull(),
    payload: jsonb("payload").$type<CandidatePayload>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    detectedAt: timestamp("detected_at", { mode: "date" }).notNull().defaultNow(),
    // Stale findings (a bill already paid, last month's anomaly) stop showing.
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    digestAt: timestamp("digest_at", { mode: "date" }),
    title: text("title"),
    body: text("body"),
    shownAt: timestamp("shown_at", { mode: "date" }),
    dismissedAt: timestamp("dismissed_at", { mode: "date" }),
    helpful: boolean("helpful"),
  },
  (table) => [
    uniqueIndex("insight_candidates_user_fingerprint_idx").on(table.userId, table.fingerprint),
    index("insight_candidates_user_digest_idx").on(table.userId, table.digestAt),
  ],
).enableRLS();

export type InsightCandidateRow = typeof insightCandidates.$inferSelect;
