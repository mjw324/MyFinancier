"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SpendingTypePill } from "./spending-type-pill";
import { ClassifyScopeDialog } from "./classify-scope-dialog";
import {
  classifyTransactionAction,
  clearTransactionClassificationAction,
} from "@/app/(routes)/(dashboard)/transactions/actions";

interface ClassifyPopoverProps {
  transactionId: string;
  spendingType: string | null;
  source: string | null;
  recurringStreamId: string | null;
  normalizedMerchant: string | null;
  nameSignature: string | null;
  merchantDisplay: string | null;
}

export function ClassifyPopover({
  transactionId,
  spendingType,
  source,
  recurringStreamId,
  normalizedMerchant,
  nameSignature,
  merchantDisplay,
}: ClassifyPopoverProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [scopeFor, setScopeFor] = useState<
    null | "necessary" | "discretionary"
  >(null);

  const hasMultipleScopes = Boolean(
    recurringStreamId || normalizedMerchant || nameSignature,
  );

  function handlePick(next: "necessary" | "discretionary") {
    if (hasMultipleScopes) {
      setScopeFor(next);
      return;
    }
    startTransition(async () => {
      const result = await classifyTransactionAction({
        transactionId,
        spendingType: next,
        scope: "transaction",
      });
      if (result.success) {
        toast.success("Updated");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      const result = await clearTransactionClassificationAction({
        transactionId,
      });
      if (result.success) {
        toast.success("Cleared");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <span onClick={(e) => e.stopPropagation()}>
            <SpendingTypePill spendingType={spendingType} source={source} />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem
            disabled={isPending}
            onSelect={() => handlePick("necessary")}
          >
            Mark necessary
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPending}
            onSelect={() => handlePick("discretionary")}
          >
            Mark discretionary
          </DropdownMenuItem>
          {spendingType && (
            <DropdownMenuItem
              disabled={isPending}
              onSelect={() => handleClear()}
            >
              Clear
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {scopeFor && (
        <ClassifyScopeDialog
          open={!!scopeFor}
          onOpenChange={(open) => !open && setScopeFor(null)}
          transactionId={transactionId}
          spendingType={scopeFor}
          hasStream={!!recurringStreamId}
          merchantLabel={
            normalizedMerchant ? merchantDisplay ?? normalizedMerchant : null
          }
          signatureLabel={nameSignature}
        />
      )}
    </>
  );
}
