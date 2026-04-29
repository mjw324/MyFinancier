"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface TransactionLabelProps {
  merchant: string | null | undefined;
  full: string | null | undefined;
  className?: string;
  truncate?: boolean;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function TransactionLabel({
  merchant,
  full,
  className,
  truncate,
}: TransactionLabelProps) {
  const fullText = full ?? "";
  const merchantText = merchant ?? "";
  const display = merchantText || fullText;

  const hasMore =
    !!merchantText &&
    !!fullText &&
    normalize(merchantText) !== normalize(fullText) &&
    normalize(fullText).length > normalize(merchantText).length;

  if (!hasMore) {
    return (
      <span className={cn(truncate && "truncate", className)}>{display}</span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline text-left border-b border-dotted border-muted-foreground/60 cursor-help hover:border-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          truncate && "truncate max-w-full",
          className,
        )}
      >
        {display}
        <span aria-hidden>…</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-mono break-words">{fullText}</p>
      </PopoverContent>
    </Popover>
  );
}
