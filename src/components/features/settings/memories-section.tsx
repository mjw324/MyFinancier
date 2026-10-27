"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  createMemoryAction,
  deleteMemoryAction,
  updateMemoryAction,
} from "@/app/(routes)/(dashboard)/settings/memory-actions";

export interface MemoryItem {
  id: string;
  content: string;
  source: string;
}

/** View, add, edit and delete what the AI assistant remembers. */
export function MemoriesSection({ memories, max, maxChars }: { memories: MemoryItem[]; max: number; maxChars: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);

  function run(work: () => Promise<{ success: boolean; error?: string }>, done: string, after?: () => void) {
    startTransition(async () => {
      const result = await work();
      if (result.success) {
        toast.success(done);
        after?.();
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  }

  function handleDelete(m: MemoryItem) {
    if (!confirm(`Forget "${m.content}"?`)) return;
    run(() => deleteMemoryAction({ memoryId: m.id }), "Memory deleted");
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Notes the AI assistant keeps in mind when it answers, such as goals or how you split bills. The assistant can
        suggest one, but it is only saved when you confirm. Don&apos;t include account numbers or passwords.
      </p>

      {memories.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing saved yet.</p>
      ) : (
        <ul className="divide-y">
          {memories.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              {editing?.id === m.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => updateMemoryAction({ memoryId: m.id, content: editing.content }), "Memory updated", () =>
                      setEditing(null),
                    );
                  }}
                >
                  <Input
                    aria-label="Memory"
                    value={editing.content}
                    maxLength={maxChars}
                    onChange={(e) => setEditing({ id: m.id, content: e.target.value })}
                    autoFocus
                  />
                  <Button type="submit" variant="ghost" size="sm" aria-label="Save memory" disabled={isPending}>
                    <Check className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label="Cancel editing" onClick={() => setEditing(null)}>
                    <X className="size-4" />
                  </Button>
                </form>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm break-words">{m.content}</span>
                    {m.source === "chat" && (
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        From chat
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit memory: ${m.content}`}
                      disabled={isPending}
                      onClick={() => setEditing({ id: m.id, content: m.content })}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete memory: ${m.content}`}
                      disabled={isPending}
                      onClick={() => handleDelete(m)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {memories.length < max && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createMemoryAction({ content: draft }), "Memory saved", () => setDraft(""));
          }}
        >
          <Input
            aria-label="New memory"
            placeholder="e.g. I'm saving for a car by next June"
            value={draft}
            maxLength={maxChars}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={isPending || draft.trim().length === 0}>
            <Plus className="size-4" /> Add
          </Button>
        </form>
      )}
    </div>
  );
}
