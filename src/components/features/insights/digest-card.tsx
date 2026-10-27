"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { insightFeedbackAction } from "@/app/(routes)/(dashboard)/dashboard/insight-actions";

export interface DigestCardItem {
  id: string;
  title: string;
  body: string;
  href?: string;
  helpful: boolean | null;
}

/**
 * This week's digest. Text is rendered as plain text (React escapes it), so
 * model wording can never become markup or a remote image.
 */
export function DigestCard({ items, weekOf }: { items: DigestCardItem[]; weekOf: string }) {
  const [visible, setVisible] = useState(items);
  const [helpful, setHelpful] = useState<Record<string, boolean | null>>(
    Object.fromEntries(items.map((i) => [i.id, i.helpful])),
  );
  const [pending, startTransition] = useTransition();

  const send = (id: string, action: "helpful" | "not_helpful" | "dismiss") => {
    const before = { visible, helpful };
    if (action === "dismiss") setVisible((v) => v.filter((i) => i.id !== id));
    else setHelpful((h) => ({ ...h, [id]: action === "helpful" }));
    startTransition(async () => {
      const res = await insightFeedbackAction({ id, action });
      if (!res.success) {
        setVisible(before.visible);
        setHelpful(before.helpful);
        toast.error(res.error);
      }
    });
  };

  if (visible.length === 0) return null;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden />
          Your week
        </CardTitle>
        <CardDescription>
          {weekOf} · figures computed by MyFinancier, wording by AI
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {visible.map((item) => (
            <li key={item.id} className="rounded-md border px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">
                  {item.href ? (
                    <Link href={item.href} className="hover:underline">
                      {item.title}
                    </Link>
                  ) : (
                    item.title
                  )}
                </p>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Dismiss"
                  disabled={pending}
                  onClick={() => send(item.id, "dismiss")}
                >
                  <X />
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
              <div className="mt-2 flex items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">Helpful?</span>
                <Button
                  variant={helpful[item.id] === true ? "secondary" : "ghost"}
                  size="icon-xs"
                  aria-label="Helpful"
                  aria-pressed={helpful[item.id] === true}
                  disabled={pending}
                  onClick={() => send(item.id, "helpful")}
                >
                  <ThumbsUp />
                </Button>
                <Button
                  variant={helpful[item.id] === false ? "secondary" : "ghost"}
                  size="icon-xs"
                  aria-label="Not helpful"
                  aria-pressed={helpful[item.id] === false}
                  disabled={pending}
                  onClick={() => send(item.id, "not_helpful")}
                >
                  <ThumbsDown />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
