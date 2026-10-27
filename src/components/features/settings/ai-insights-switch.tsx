"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { updateAiOptInAction } from "@/app/(routes)/(dashboard)/settings/ai-actions";

export function AiInsightsSwitch({
  initial,
  available,
  consentText,
}: {
  initial: boolean;
  /** False when AI_ENABLED is off on this server. */
  available: boolean;
  consentText: string;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  const onChange = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      const res = await updateAiOptInAction(next);
      if (!res.success) {
        setOn(!next);
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="ai-insights" className="text-sm font-medium">
          AI features
        </Label>
        <p className="text-xs text-muted-foreground">{consentText}</p>
        {!available && (
          <p className="text-xs text-muted-foreground">
            AI features are currently unavailable. Your choice is saved and applies once they are.
          </p>
        )}
      </div>
      <Switch id="ai-insights" checked={on} disabled={pending} onCheckedChange={onChange} />
    </div>
  );
}
