"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { explainChartAction } from "@/app/(routes)/(dashboard)/dashboard/explain-actions";
import type { ExplainChart } from "@/lib/explain/slices";
import type { DashboardPeriodKey } from "@/lib/utils/date-ranges";

/**
 * "Explain" on a dashboard chart. Sends only the chart name and period; the
 * server rebuilds the figures. The answer is rendered as plain text.
 */
export function ExplainButton({ chart, period }: { chart: ExplainChart; period: DashboardPeriodKey }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onOpenChange = (open: boolean) => {
    if (!open || text || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await explainChartAction({ chart, period });
      if (res.success) setText(res.data.text);
      else setError(res.error);
    });
  };

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Sparkles />
          Explain
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        {pending && <p className="text-muted-foreground">Looking at your numbers…</p>}
        {error && <p className="text-destructive">{error}</p>}
        {text && (
          <div className="flex flex-col gap-2">
            <p>{text}</p>
            <p className="text-xs text-muted-foreground">Figures computed by MyFinancier, wording by AI.</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
