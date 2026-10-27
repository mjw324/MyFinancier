"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { naturalSearchAction } from "../search-actions";

/** Plain-language search; the result is an ordinary filtered /transactions URL. */
export function AskSearch() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        startTransition(async () => {
          const res = await naturalSearchAction({ text });
          if (res.success) router.push(res.data.href);
          else toast.error(res.error);
        });
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={200}
        placeholder='Try "Amazon over $50 last quarter"'
        aria-label="Search transactions in plain language"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        <Sparkles />
        {pending ? "Searching…" : "Ask"}
      </Button>
    </form>
  );
}
