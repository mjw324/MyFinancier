"use client";

import { useState, useTransition } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCategory, formatCurrency, formatDate } from "@/lib/utils/format";
import { PLAID_PRIMARIES, type PlaidPrimary } from "@/lib/categorize/categories";
import {
  acceptCategorySuggestionAction,
  rejectCategorySuggestionAction,
  requestCategorySuggestionsAction,
} from "../actions";

export interface QueueItem {
  id: string;
  suggested: string | null;
  date: string;
  label: string;
  amount: string;
  plaidCategory: string | null;
}

export function SuggestButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await requestCategorySuggestionsAction();
          if (!res.success) return void toast.error(res.error);
          const { suggested, uncertain, ruled } = res.data;
          toast.success(
            suggested + uncertain + ruled === 0
              ? "Nothing new to categorize."
              : `${suggested} suggestion${suggested === 1 ? "" : "s"}, ${uncertain} to pick yourself${ruled ? `, ${ruled} set by your rules` : ""}.`,
          );
        })
      }
    >
      <Sparkles />
      {pending ? "Asking…" : "Suggest categories"}
    </Button>
  );
}

/**
 * Suggestions waiting for a decision. Nothing changes until the user clicks
 * Accept; transaction text is rendered as plain text.
 */
export function ReviewQueue({ items }: { items: QueueItem[] }) {
  // Derived from the server's items (not copied into state), so new
  // suggestions show up as soon as the page revalidates.
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [choice, setChoice] = useState<Record<string, PlaidPrimary | "">>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const visible = items.filter((i) => !decided.has(i.id));
  const chosen = (item: QueueItem) => choice[item.id] ?? ((item.suggested as PlaidPrimary | null) || "");

  const decide = (item: QueueItem, accept: boolean) => {
    const category = chosen(item);
    if (accept && !category) return void toast.error("Pick a category first.");
    setDecided((d) => new Set(d).add(item.id));
    startTransition(async () => {
      const res = accept
        ? await acceptCategorySuggestionAction({
            suggestionId: item.id,
            category: category as PlaidPrimary,
            rememberForMerchant: remember[item.id] ?? false,
          })
        : await rejectCategorySuggestionAction({ suggestionId: item.id });
      if (!res.success) {
        setDecided((d) => {
          const next = new Set(d);
          next.delete(item.id);
          return next;
        });
        toast.error(res.error);
      }
    });
  };

  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">No suggestions waiting for review.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {visible.map((item) => (
        <li key={item.id} className="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item.label}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(item.date)} · {Number(item.amount) > 0 ? "-" : "+"}
              {formatCurrency(Math.abs(Number(item.amount)))}
              {item.plaidCategory ? ` · Bank says ${formatCategory(item.plaidCategory)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={chosen(item) || undefined}
              onValueChange={(v) => setChoice((c) => ({ ...c, [item.id]: v as PlaidPrimary }))}
            >
              <SelectTrigger className="w-48" aria-label="Category">
                <SelectValue placeholder={item.suggested ? undefined : "Not sure — pick one"} />
              </SelectTrigger>
              <SelectContent>
                {PLAID_PRIMARIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {formatCategory(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Switch
                id={`remember-${item.id}`}
                checked={remember[item.id] ?? false}
                onCheckedChange={(v) => setRemember((r) => ({ ...r, [item.id]: v }))}
              />
              <Label htmlFor={`remember-${item.id}`} className="text-xs font-normal">
                Always for this merchant
              </Label>
            </div>
            <Button size="sm" disabled={pending} onClick={() => decide(item, true)}>
              <Check />
              Accept
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(item, false)} aria-label="Reject">
              <X />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
