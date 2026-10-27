"use client";

/**
 * The approval card for an assistant proposal (lib/chat/proposals.ts).
 *
 * What the card lists comes from previewProposalAction, which reads the
 * proposal from the stored transcript and the user's own rows; nothing here
 * is text the model typed. Apply runs applyProposalAction (the only write)
 * and then answers the tool approval so the assistant can report the
 * outcome; Decline only answers the approval.
 */

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { isToolUIPart } from "ai";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProposalPreview } from "@/lib/chat/proposals";
import type { ChatUIMessage } from "@/lib/chat/types";
import { applyProposalAction, previewProposalAction } from "@/app/(routes)/(dashboard)/assistant/proposal-actions";

export const PROPOSAL_TOOL_NAMES: ReadonlySet<string> = new Set(["proposeRecategorize", "proposeBudget", "proposeMemory"]);

export interface ProposalContextValue {
  chatId: string;
  messages: ChatUIMessage[];
  /** False while a response is streaming (the transcript isn't saved yet). */
  ready: boolean;
  respond: (approvalId: string, approved: boolean) => void;
}

export const ProposalContext = createContext<ProposalContextValue | null>(null);

type Part = ChatUIMessage["parts"][number];

function findPart(messages: ChatUIMessage[], toolCallId: string): Part | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const part = messages[i].parts.find((p) => isToolUIPart(p) && p.toolCallId === toolCallId);
    if (part) return part;
  }
  return null;
}

const TITLES: Record<string, string> = {
  proposeRecategorize: "Change categories",
  proposeBudget: "Create a budget",
  proposeMemory: "Remember this",
};

function Shell({ title, children, muted }: { title: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`my-2 flex flex-col gap-2 rounded-lg border p-3 text-sm ${muted ? "bg-muted/40" : "bg-card"}`}>
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Suggested change · {title}</span>
      {children}
    </div>
  );
}

function PreviewBody({ preview }: { preview: ProposalPreview }) {
  switch (preview.kind) {
    case "proposeRecategorize":
      return (
        <>
          <p>
            Move {preview.transactions.length === 1 ? "this transaction" : `these ${preview.transactions.length} transactions`} to{" "}
            <strong>{preview.category.label}</strong>:
          </p>
          <table className="w-full text-xs">
            <tbody>
              {preview.transactions.map((t) => (
                <tr key={t.id} className="border-t first:border-t-0">
                  <td className="py-1 pr-2 text-muted-foreground tabular-nums">{t.date}</td>
                  <td className="py-1 pr-2">{t.label}</td>
                  <td className="py-1 pr-2 text-muted-foreground">{t.category}</td>
                  <td className="py-1 text-right tabular-nums">
                    {t.direction === "in" ? "+" : ""}
                    {t.amount.display}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
    case "proposeBudget":
      return (
        <p>
          A <strong>{preview.period}</strong> budget of <strong>{preview.amount.display}</strong> for{" "}
          <strong>{preview.categoryLabel}</strong>, starting {preview.startDate}.
        </p>
      );
    case "proposeMemory":
      return (
        <p>
          Save this note for future chats: <q className="italic">{preview.content}</q>
          <span className="block text-xs text-muted-foreground">You can edit or delete memories in Settings.</span>
        </p>
      );
  }
}

function PendingCard({ ctx, toolName, toolCallId, approvalId }: { ctx: ProposalContextValue; toolName: string; toolCallId: string; approvalId: string }) {
  const [preview, setPreview] = useState<ProposalPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { chatId, ready } = ctx;

  useEffect(() => {
    if (!ready || preview || error) return;
    let cancelled = false;
    void previewProposalAction({ chatId, toolCallId }).then((res) => {
      if (cancelled) return;
      if (res.success) setPreview(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, chatId, toolCallId, preview, error]);

  const apply = () =>
    startTransition(async () => {
      const res = await applyProposalAction({ chatId, toolCallId });
      if (res.success) ctx.respond(res.data.approvalId, true);
      else setError(res.error);
    });

  return (
    <Shell title={TITLES[toolName] ?? "Change"}>
      {preview ? (
        <PreviewBody preview={preview} />
      ) : !error ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading the details…
        </p>
      ) : null}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={apply} disabled={!preview || !!error || pending || !ready}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} Apply
        </Button>
        <Button size="sm" variant="outline" onClick={() => ctx.respond(approvalId, false)} disabled={pending || !ready}>
          <X className="size-4" aria-hidden /> Decline
        </Button>
      </div>
    </Shell>
  );
}

/** One proposal tool part, in whichever state it is in. */
export function ProposalCard({ toolName, toolCallId }: { toolName: string; toolCallId: string }) {
  const ctx = useContext(ProposalContext);
  if (!ctx) return null;
  const part = findPart(ctx.messages, toolCallId);
  if (!part || !isToolUIPart(part)) return null;
  const title = TITLES[toolName] ?? "Change";

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return <p className="my-1 text-xs text-muted-foreground">Preparing a suggestion…</p>;
    case "approval-requested":
      if (part.approval.isAutomatic) return null;
      return <PendingCard ctx={ctx} toolName={toolName} toolCallId={toolCallId} approvalId={part.approval.id} />;
    case "approval-responded":
      return (
        <Shell title={title} muted>
          <p className="text-xs text-muted-foreground">{part.approval.approved ? "Applying…" : "Declined."}</p>
        </Shell>
      );
    case "output-available": {
      const status = (part.output as { status?: string } | undefined)?.status;
      return (
        <Shell title={title} muted>
          <p className="text-xs text-muted-foreground">{status === "applied" ? "Applied." : "Not applied."}</p>
        </Shell>
      );
    }
    case "output-denied":
      return part.approval.isAutomatic ? (
        <Shell title={title} muted>
          <p className="text-xs text-muted-foreground">The assistant suggested a change it can&apos;t offer: {part.approval.reason}</p>
        </Shell>
      ) : (
        <Shell title={title} muted>
          <p className="text-xs text-muted-foreground">Declined.</p>
        </Shell>
      );
    case "output-error":
      return (
        <Shell title={title} muted>
          <p className="text-xs text-muted-foreground">This suggestion couldn&apos;t be checked.</p>
        </Shell>
      );
  }
}
