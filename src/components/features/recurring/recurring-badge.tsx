"use client";

import { useState } from "react";
import { Repeat } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StreamDetailSheet } from "./stream-detail-sheet";

interface RecurringBadgeProps {
  streamId: string;
  /** Optional preview info shown in the tooltip without fetching. */
  hint?: string;
}

export function RecurringBadge({ streamId, hint }: RecurringBadgeProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Recurring transaction"
          >
            <Repeat className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {hint ?? "Recurring — click for details"}
        </TooltipContent>
      </Tooltip>
      <StreamDetailSheet
        streamId={open ? streamId : null}
        onOpenChange={(o) => setOpen(o)}
      />
    </>
  );
}
