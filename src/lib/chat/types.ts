/**
 * The chat's UIMessage type, shared by the route and the client (type-only
 * imports, so no server code reaches the browser bundle).
 */

import type { InferUITools, UIMessage } from "ai";
import { z } from "zod";
import type { ChatTools } from "./tools";

/**
 * Written by the server after every answer, from deterministic checks:
 * - figures: currency / percent figures not found in that turn's tool outputs
 *   or snapshot (the UI shows a warning listing them)
 * - scope: "withheld" when the answer recommended a security (its text was
 *   replaced by the fixed redirect), "redirected" when the request did
 */
export const GuardSchema = z.object({
  figures: z.object({ ok: z.boolean(), checked: z.number(), unverified: z.array(z.string()) }),
  scope: z.enum(["ok", "redirected", "withheld"]),
});
export type GuardData = z.infer<typeof GuardSchema>;

export type ChatDataTypes = { guard: GuardData };
export type ChatUIMessage = UIMessage<never, ChatDataTypes, InferUITools<ChatTools>>;

export const chatDataSchemas = { guard: GuardSchema };
