/**
 * A scripted streaming model for chat tests (ai/test's MockLanguageModelV4,
 * never a real API). Each model call (step) asks the script what to do,
 * given the prompt the app sent: call tools, or write text. Records every
 * call's options so tests can inspect the prompt, tools and cache markers.
 */

import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

type CallOptions = Parameters<MockLanguageModelV4["doStream"]>[0];

export interface StepContext {
  step: number;
  /** System messages' text, in order. */
  system: string[];
  /** The last user message's text. */
  lastUser: string;
  /** Tool results the model has seen so far in this turn, oldest first. */
  toolResults: Array<{ toolName: string; output: unknown }>;
  options: CallOptions;
}

export type StepAction = { tools: Array<{ name: string; input: unknown }> } | { text: string };

const USAGE = {
  inputTokens: { total: 2_000, noCache: 500, cacheRead: 1_500, cacheWrite: undefined },
  outputTokens: { total: 100, text: 100, reasoning: undefined },
};

function contextOf(options: CallOptions, step: number): StepContext {
  const system: string[] = [];
  let lastUser = "";
  const toolResults: StepContext["toolResults"] = [];
  for (const m of options.prompt) {
    if (m.role === "system") system.push(m.content);
    if (m.role === "user") lastUser = m.content.map((p: { type: string; text?: string }) => (p.type === "text" ? p.text : "")).join("");
    if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type === "tool-result") {
          const out = p.output as { type: string; value?: unknown };
          toolResults.push({ toolName: p.toolName, output: out.type === "json" ? out.value : out });
        }
      }
    }
  }
  return { step, system, lastUser, toolResults, options };
}

export function mockChatModel(script: (ctx: StepContext) => StepAction) {
  const calls: StepContext[] = [];
  let ids = 0;
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      const ctx = contextOf(options as CallOptions, calls.length);
      calls.push(ctx);
      const action = script(ctx);
      const chunks: unknown[] = [];
      if ("tools" in action) {
        for (const t of action.tools) {
          chunks.push({ type: "tool-call", toolCallId: `call_${++ids}`, toolName: t.name, input: JSON.stringify(t.input) });
        }
        chunks.push({ type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: USAGE });
      } else {
        chunks.push(
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: action.text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
        );
      }
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
  return { model, calls };
}

/** Read a UI message stream response (SSE) into its chunks. */
export async function readChunks(response: Response): Promise<Array<Record<string, unknown> & { type: string }>> {
  const body = await response.text();
  return body
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
}
