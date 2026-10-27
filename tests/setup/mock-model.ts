/**
 * AI SDK mock model (ai/test) for tests: never calls a real API. `respond`
 * gets the user prompt text the app sent and returns the model's JSON answer
 * (an object, or `{ elements }` for Output.array — wrapped automatically when
 * an array is returned).
 */

import { MockLanguageModelV4 } from "ai/test";

export type Responder = (prompt: string, instructions: string) => unknown;

export function mockModel(respond: Responder) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      let instructions = "";
      let prompt = "";
      for (const message of options.prompt) {
        if (message.role === "system") instructions += message.content;
        else if (message.role === "user") {
          for (const part of message.content) if (part.type === "text") prompt += part.text;
        }
      }
      prompts.push(prompt);
      const answer = respond(prompt, instructions);
      const json = Array.isArray(answer) ? { elements: answer } : answer;
      return {
        content: [{ type: "text", text: JSON.stringify(json) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1_000, noCache: 1_000, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 200, text: 200, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

/** The `items` array of a categorize batch prompt. */
export function promptItems<T = { ref: string; merchant?: string; description: string; direction: string; bankGuess?: string }>(
  prompt: string,
): T[] {
  return (JSON.parse(prompt) as { items: T[] }).items;
}
