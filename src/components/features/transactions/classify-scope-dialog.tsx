"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { classifyTransactionAction } from "@/app/(routes)/(dashboard)/transactions/actions";

export type ClassifyScope =
  | "transaction"
  | "stream"
  | "merchant"
  | "name_signature";

interface ClassifyScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string;
  spendingType: "necessary" | "discretionary";
  hasStream: boolean;
  merchantLabel: string | null;
  signatureLabel: string | null;
}

export function ClassifyScopeDialog({
  open,
  onOpenChange,
  transactionId,
  spendingType,
  hasStream,
  merchantLabel,
  signatureLabel,
}: ClassifyScopeDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const defaultScope: ClassifyScope = hasStream
    ? "stream"
    : merchantLabel
      ? "merchant"
      : signatureLabel
        ? "name_signature"
        : "transaction";
  const [scope, setScope] = useState<ClassifyScope>(defaultScope);

  function handleSubmit() {
    startTransition(async () => {
      const result = await classifyTransactionAction({
        transactionId,
        spendingType,
        scope,
      });
      if (result.success) {
        toast.success("Updated");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const verb = spendingType === "necessary" ? "necessary" : "discretionary";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as {verb}</DialogTitle>
          <DialogDescription>
            Choose how widely this classification should apply.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={scope}
          onValueChange={(v) => setScope(v as ClassifyScope)}
          className="py-2"
        >
          {hasStream && (
            <div className="flex items-start gap-3">
              <RadioGroupItem value="stream" id="scope-stream" />
              <div className="space-y-0.5">
                <Label htmlFor="scope-stream" className="font-medium">
                  Apply to this stream (recommended)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Every past and future transaction in this recurring stream.
                </p>
              </div>
            </div>
          )}
          {!hasStream && merchantLabel && (
            <div className="flex items-start gap-3">
              <RadioGroupItem value="merchant" id="scope-merchant" />
              <div className="space-y-0.5">
                <Label htmlFor="scope-merchant" className="font-medium">
                  Apply to all transactions from {merchantLabel}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Creates a rule. Future syncs auto-classify too.
                </p>
              </div>
            </div>
          )}
          {!hasStream && signatureLabel && signatureLabel !== merchantLabel && (
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="name_signature"
                id="scope-signature"
              />
              <div className="space-y-0.5">
                <Label htmlFor="scope-signature" className="font-medium">
                  Apply to similar transactions: {signatureLabel}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Creates a rule that matches the transaction name pattern.
                </p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="transaction" id="scope-transaction" />
            <div className="space-y-0.5">
              <Label htmlFor="scope-transaction" className="font-medium">
                {hasStream
                  ? "Apply to this transaction only (override)"
                  : "Apply to this transaction only"}
              </Label>
              <p className="text-xs text-muted-foreground">
                {hasStream
                  ? "Stream stays classified as before."
                  : "Doesn't create a rule."}
              </p>
            </div>
          </div>
        </RadioGroup>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
