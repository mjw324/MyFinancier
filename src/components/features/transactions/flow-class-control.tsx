"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  allowedFlowClasses,
  flowClassOptionLabel,
  FLOW_CLASS_OPTION_LABEL,
} from "@/lib/analytics/flow-options";
import type { FlowClass } from "@/lib/analytics/flow";
import {
  clearFlowClassAction,
  setFlowClassAction,
  unpairTransferAction,
} from "@/app/(routes)/(dashboard)/transactions/actions";

interface FlowClassControlProps {
  transactionId: string;
  amount: string;
  flowClass: string | null | undefined;
  flowClassSource: string | null | undefined;
  transferPairId: string | null | undefined;
}

/**
 * "Counts as": shows how a transaction is counted in totals (its flow class)
 * and lets the user override it, return it to automatic, or break a
 * transfer pair the app got wrong.
 */
export function FlowClassControl({
  transactionId,
  amount,
  flowClass,
  flowClassSource,
  transferPairId,
}: FlowClassControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState<string | null>(flowClass ?? null);
  const [manual, setManual] = useState(flowClassSource === "manual");
  const [paired, setPaired] = useState(Boolean(transferPairId));

  useEffect(() => {
    setValue(flowClass ?? null);
    setManual(flowClassSource === "manual");
    setPaired(Boolean(transferPairId));
  }, [flowClass, flowClassSource, transferPairId]);

  const options = allowedFlowClasses(amount);
  if (options.length === 0) return null;

  const currentLabel = flowClassOptionLabel(value) ?? "Not classified yet";

  function run(
    action: () => Promise<
      | { success: true; flowClass: FlowClass | null }
      | { success: false; error: string }
    >,
    onSuccess: (flowClass: FlowClass | null) => void,
    message: string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.success) {
        onSuccess(result.flowClass);
        toast.success(message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handlePick(next: string) {
    if (next === value && manual) return;
    run(
      () => setFlowClassAction({ transactionId, flowClass: next as FlowClass }),
      (fc) => {
        setValue(fc);
        setManual(true);
        if (next !== "cc_payment" && next !== "internal_transfer") setPaired(false);
      },
      "Classification updated",
    );
  }

  function handleReset() {
    run(
      () => clearFlowClassAction({ transactionId }),
      (fc) => {
        setValue(fc);
        setManual(false);
      },
      "Reset to automatic",
    );
  }

  function handleUnpair() {
    run(
      () => unpairTransferAction({ transactionId }),
      (fc) => {
        setValue(fc);
        setManual(true);
        setPaired(false);
      },
      "No longer treated as a transfer",
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="flow-class">Counts as</Label>
        {manual && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-0 text-xs"
            disabled={isPending}
            onClick={handleReset}
          >
            <RotateCcw className="size-3" />
            Automatic
          </Button>
        )}
      </div>
      <Select value={value ?? undefined} onValueChange={handlePick} disabled={isPending}>
        <SelectTrigger id="flow-class" aria-label="How this transaction counts">
          <SelectValue placeholder={currentLabel} />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c} value={c}>
              {FLOW_CLASS_OPTION_LABEL[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {manual ? "Set by you." : "Set automatically."}{" "}
          {paired ? "Matched with a transfer on another of your accounts." : null}
        </p>
        {paired && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto shrink-0 px-2 py-0 text-xs"
            disabled={isPending}
            onClick={handleUnpair}
          >
            <Unlink className="size-3" />
            Not a transfer
          </Button>
        )}
      </div>
    </div>
  );
}
