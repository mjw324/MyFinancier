"use client";

/**
 * The AI assistant thread: assistant-ui primitives over an AI SDK useChat.
 *
 * - The transport sends only the new message; the server holds the history.
 * - Tool parts render as charts from their output (./tool-results.tsx).
 * - Markdown is rendered without raw HTML, images or links (an injected
 *   instruction can't make the page fetch a URL or offer one to click).
 * - The server's `data-guard` part drives the unverified-figures warning and
 *   hides an answer that was withheld for recommending a security.
 */

import { useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { AlertTriangle, ArrowUp, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatUIMessage, GuardData } from "@/lib/chat/types";
import { ToolResult } from "./tool-results";

const SUGGESTIONS = [
  "How much did I spend last month, and on what?",
  "Am I on track with my budgets?",
  "What subscriptions am I paying for?",
  "Did I spend more this month than last month?",
];

/** The guard verdict of the message being rendered, if the server sent one. */
function useGuard(): GuardData | null {
  return useAuiState((s) => {
    const part = s.message.parts.find((p) => p.type === "data" && p.name === "guard");
    return part && part.type === "data" ? (part.data as GuardData) : null;
  });
}

function MarkdownText() {
  const guard = useGuard();
  if (guard?.scope === "withheld") return null;
  return (
    <MarkdownTextPrimitive
      className="flex flex-col gap-2 leading-relaxed [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_table]:text-xs [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5"
      skipHtml
      disallowedElements={["img", "a", "iframe", "script", "style", "video", "audio", "source", "picture"]}
      unwrapDisallowed
      urlTransform={() => ""}
    />
  );
}

function GuardNotice({ data }: { data: GuardData }) {
  if (data.scope === "withheld") {
    return (
      <p className="my-2 text-sm">
        This answer was withheld because it recommended a specific investment, which this assistant doesn&apos;t do.
        I can help with budgeting, spending and saving, or explain how investment types work in general.
      </p>
    );
  }
  if (!data.figures.ok) {
    return (
      <p className="my-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Some figures in this answer don&apos;t match your data and may be wrong: {data.figures.unverified.join(", ")}. Check the
          charts above or your Transactions page.
        </span>
      </p>
    );
  }
  return null;
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5" aria-hidden /> AI assistant
      </div>
      <div className="text-sm">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            tools: { Fallback: ({ toolName, result }) => <ToolResult toolName={toolName} result={result} /> },
            data: { by_name: { guard: ({ data }) => <GuardNotice data={data as GuardData} /> } },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

/** Error responses are `{ success: false, error }`; show the message, not the JSON. */
function errorText(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {}
  return "Something went wrong. Please try again.";
}

export function AssistantChat({ chatId, initialMessages }: { chatId: string; initialMessages: ChatUIMessage[] }) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, message: messages[messages.length - 1] } }),
      }),
    [],
  );
  const chat = useChat<ChatUIMessage>({ id: chatId, messages: initialMessages, transport });
  const runtime = useAISDKRuntime(chat);

  // Keep the chat in the URL once it has messages, so a reload restores it.
  const started = chat.messages.length > 0;
  useEffect(() => {
    if (!started) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("chat") !== chatId) {
      url.searchParams.set("chat", chatId);
      window.history.replaceState(null, "", url);
    }
  }, [started, chatId]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex min-h-[60vh] flex-col rounded-lg border bg-background">
        <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <ThreadPrimitive.Empty>
            <div className="flex flex-col gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">Ask about your spending, budgets, bills or balances.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <ThreadPrimitive.Suggestion key={s} prompt={s} send asChild>
                    <Button variant="outline" size="sm" className="h-auto whitespace-normal text-left">
                      {s}
                    </Button>
                  </ThreadPrimitive.Suggestion>
                ))}
              </div>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          {chat.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(chat.error)}
            </p>
          )}
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="flex items-end gap-2 border-t p-3">
          <ComposerPrimitive.Input
            placeholder="Ask about your money…"
            maxLength={2000}
            className="min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none"
          />
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send asChild>
              <Button size="icon" aria-label="Send">
                <ArrowUp />
              </Button>
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel asChild>
              <Button size="icon" variant="outline" aria-label="Stop">
                <Square />
              </Button>
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
