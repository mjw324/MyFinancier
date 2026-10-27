/**
 * One chat turn, from a validated request to a streamed, guarded, persisted
 * answer. The route (app/api/chat/route.ts) only authenticates and resolves
 * the user's date; everything else lives here so tests can drive it with the
 * mock model.
 *
 * Order of checks: kill switch → input → opt-in → monthly budget → rate limit
 * → chat ownership. History is loaded from the database (never trusted from
 * the client, so earlier tool outputs can't be forged) and validated against
 * the current tools; the client sends only its new message.
 *
 * After the model finishes, deterministic guards run on the answer
 * (lib/chat/guards.ts) and their verdict is streamed and saved as a
 * `data-guard` part. The turn iterates the model's UI stream itself, so the
 * model call runs to completion and the answer is saved even when the
 * browser disconnects mid-stream (consumeStream() lifts backpressure).
 */

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  isToolUIPart,
  streamText,
  TypeValidationError,
  validateUIMessages,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { getAiConsent } from "@/lib/ai/consent";
import { isAiEnabled } from "@/lib/ai/models";
import { aiTelemetry, getModel } from "@/lib/ai/provider";
import { CHAT_RATE_LIMIT, consumeRateLimit } from "@/lib/ai/rate-limit";
import { hasBudgetRemaining, recordAiUsage } from "@/lib/ai/usage";
import { describeError } from "@/lib/logging";
import { checkFigures, checkScope, collectGrounding, SCOPE_REDIRECT } from "./guards";
import { chatInstructions } from "./prompt";
import { buildSnapshot } from "./snapshot";
import { CHAT_ID_RE, claimChat, loadChatMessages, MAX_HISTORY_MESSAGES, saveChatMessages } from "./store";
import { buildTools } from "./tools";
import { chatDataSchemas, type ChatUIMessage, type GuardData } from "./types";

export const MAX_USER_TEXT = 2_000;
/** Tool round-trips per answer; the last step must leave room to write. */
export const MAX_STEPS = 6;
export const CHAT_TIMEOUT = { totalMs: 90_000, stepMs: 45_000, toolMs: 15_000 } as const;

export const ChatRequestSchema = z.object({
  id: z.string().regex(CHAT_ID_RE),
  message: z.object({
    id: z.string().min(1).max(100),
    role: z.literal("user"),
    parts: z
      .array(z.object({ type: z.string(), text: z.string().optional() }).loose())
      .min(1)
      .max(10),
  }),
});

type ApiError = { success: false; error: string };

function errorResponse(status: number, error: string, headers?: HeadersInit): Response {
  return Response.json({ success: false, error } satisfies ApiError, { status, headers });
}

/**
 * Transcripts are never logged, and some AI SDK errors carry message content
 * (a TypeValidationError includes the value it rejected), so only the error's
 * name and status are logged.
 */
function logChatError(event: string, error: unknown, context: Record<string, string>) {
  const { name, status } = describeError(error);
  console.error(`[${event}] ${JSON.stringify({ ...context, name, status })}`);
}

/** The answer's text and this turn's tool outputs → the guard verdict. */
export function guardAnswer(response: ChatUIMessage, snapshotData: unknown): GuardData {
  const text = response.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
  const outputs = response.parts.filter((p) => isToolUIPart(p) && p.state === "output-available").map((p) => (p as { output: unknown }).output);
  return {
    figures: checkFigures(text, collectGrounding([snapshotData, ...outputs])),
    scope: checkScope(text, "answer").allowed ? "ok" : "withheld",
  };
}

/** The message as saved: the guard part appended, withheld text replaced by the redirect. */
export function applyGuard(response: ChatUIMessage, guard: GuardData): ChatUIMessage {
  const parts =
    guard.scope === "withheld"
      ? [...response.parts.filter((p) => p.type !== "text"), { type: "text" as const, text: SCOPE_REDIRECT }]
      : response.parts;
  return { ...response, parts: [...parts, { type: "data-guard", data: guard }] };
}

const OK_FIGURES = { ok: true, checked: 0, unverified: [] };

export async function runChatTurn(input: {
  userId: string;
  body: unknown;
  /** The user's calendar date, UTC midnight. */
  today: Date;
  timeZone: string;
  model?: LanguageModel;
  now?: Date;
  /** Keep work alive after the response closes (the route passes next/server's after()). */
  waitUntil?: (work: Promise<unknown>) => void;
}): Promise<Response> {
  const { userId, today, timeZone } = input;
  const now = input.now ?? new Date();

  if (!isAiEnabled()) return errorResponse(503, "The AI assistant is turned off.");
  const parsed = ChatRequestSchema.safeParse(input.body);
  if (!parsed.success) return errorResponse(400, "Invalid request.");
  const chatId = parsed.data.id;
  const text = parsed.data.message.parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  if (!text) return errorResponse(400, "Type a question first.");
  if (text.length > MAX_USER_TEXT) return errorResponse(400, `Questions are limited to ${MAX_USER_TEXT} characters.`);

  if (!(await getAiConsent(userId)).optedIn) {
    return errorResponse(403, "Turn on AI features in Settings to use the assistant.");
  }
  if (!(await hasBudgetRemaining(userId, now))) {
    return errorResponse(429, "You've reached this month's AI limit. The assistant is available again on the 1st.");
  }
  const limit = await consumeRateLimit(userId, "chat", CHAT_RATE_LIMIT, now);
  if (!limit.allowed) {
    const retry = Math.max(1, Math.ceil((limit.resetAt.getTime() - now.getTime()) / 1000));
    return errorResponse(429, "That's a lot of questions in a short time. Please wait a few minutes.", {
      "Retry-After": String(retry),
    });
  }
  if (!(await claimChat(userId, chatId, now))) return errorResponse(404, "Chat not found.");

  const tools = buildTools({ userId, today, timeZone });
  let history: ChatUIMessage[] = [];
  const stored = await loadChatMessages(userId, chatId);
  if (stored.length > 0) {
    try {
      history = await validateUIMessages<ChatUIMessage>({ messages: stored, tools, dataSchemas: chatDataSchemas });
    } catch (error) {
      if (!TypeValidationError.isInstance(error)) throw error;
      // A schema change made old turns unreadable: start the model fresh, keep the rows.
      logChatError("chat.history_invalid", error, { userId, chatId });
    }
  }

  const userMessage: ChatUIMessage = { id: parsed.data.message.id, role: "user", parts: [{ type: "text", text }] };
  // Re-sending a message (regenerate) replaces it and everything after it.
  const at = history.findIndex((m) => m.id === userMessage.id);
  const messages = [...(at >= 0 ? history.slice(0, at) : history), userMessage].slice(-MAX_HISTORY_MESSAGES);

  if (!checkScope(text, "request").allowed) {
    return redirectResponse(userId, chatId, messages, now);
  }

  const snapshot = await buildSnapshot(userId, today);
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  input.waitUntil?.(done);

  const stream = createUIMessageStream<ChatUIMessage>({
    onError: (error) => {
      logChatError("chat.stream_failed", error, { userId, chatId });
      return "Something went wrong answering that. Please try again.";
    },
    execute: async ({ writer }) => {
      try {
        const result = streamText({
          model: input.model ?? getModel("mid"),
          instructions: chatInstructions({ today, timeZone, snapshotText: snapshot.text, memories: snapshot.memories }),
          messages: await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true }),
          tools,
          stopWhen: isStepCount(MAX_STEPS),
          timeout: CHAT_TIMEOUT,
          maxRetries: 1,
          maxOutputTokens: 1_500,
          telemetry: aiTelemetry("chat"),
          onEnd: async ({ totalUsage }) => {
            await recordAiUsage({ userId, feature: "chat", tier: "mid", usage: totalUsage });
          },
        });
        // Run to completion even if the browser goes away.
        void result.consumeStream({ onError: (error) => logChatError("chat.consume_failed", error, { userId, chatId }) });

        let response: ChatUIMessage | null = null;
        const ui = result.toUIMessageStream<ChatUIMessage>({
          originalMessages: messages,
          generateMessageId: generateId,
          sendFinish: false,
          onError: (error) => {
            logChatError("chat.stream_failed", error, { userId, chatId });
            return "Something went wrong answering that. Please try again.";
          },
          onEnd: ({ responseMessage }) => {
            response = responseMessage;
          },
        });
        for await (const chunk of ui) writer.write(chunk);

        const answer = response as ChatUIMessage | null;
        if (!answer) return;
        const guard = guardAnswer(answer, { ...snapshot.data, memories: snapshot.memories.notes });
        writer.write({ type: "data-guard", data: guard });
        writer.write({ type: "finish" });
        await saveChatMessages(userId, chatId, [...messages, applyGuard(answer, guard)]);
      } finally {
        finish();
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/** An out-of-scope request: the fixed redirect, saved and streamed, with no model call. */
async function redirectResponse(userId: string, chatId: string, messages: ChatUIMessage[], now: Date): Promise<Response> {
  const guard: GuardData = { figures: OK_FIGURES, scope: "redirected" };
  const reply: ChatUIMessage = {
    id: generateId(),
    role: "assistant",
    parts: [
      { type: "text", text: SCOPE_REDIRECT },
      { type: "data-guard", data: guard },
    ],
  };
  await saveChatMessages(userId, chatId, [...messages, reply], now);
  const stream = createUIMessageStream<ChatUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageId: reply.id });
      writer.write({ type: "text-start", id: "t" });
      writer.write({ type: "text-delta", id: "t", delta: SCOPE_REDIRECT });
      writer.write({ type: "text-end", id: "t" });
      writer.write({ type: "data-guard", data: guard });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
