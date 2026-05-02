"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RotateCcw } from "lucide-react";
import { displayName, formatCategory } from "@/lib/utils/format";
import { updateTransactionOverridesAction } from "@/app/(routes)/(dashboard)/transactions/actions";
import { ClassifyPopover } from "@/components/features/transactions/classify-popover";

const NONE_CATEGORY = "__none__";

interface EditTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    id: string;
    name: string;
    merchantName: string | null;
    amount: string;
    category: string | null;
    customName: string | null;
    customCategory: string | null;
    recurringStreamId: string | null;
    spendingType: string | null;
    spendingTypeSource: string | null;
    normalizedMerchant: string | null;
    nameSignature: string | null;
  };
  categories: string[];
}

export function EditTransactionDialog({
  open,
  onOpenChange,
  transaction,
  categories,
}: EditTransactionDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [nickname, setNickname] = useState(transaction.customName ?? "");
  const [category, setCategory] = useState<string>(
    transaction.customCategory ?? NONE_CATEGORY,
  );

  // Reset local state when the dialog opens for a different transaction
  useEffect(() => {
    if (open) {
      setNickname(transaction.customName ?? "");
      setCategory(transaction.customCategory ?? NONE_CATEGORY);
    }
  }, [open, transaction.customName, transaction.customCategory]);

  const plaidName = transaction.merchantName || transaction.name;
  const plaidCategory = transaction.category;

  // Make sure the dropdown shows the current Plaid category as an option even
  // when no transaction yet has a custom override of it.
  const categoryOptions = Array.from(
    new Set(
      [...categories, plaidCategory ?? null, transaction.customCategory ?? null]
        .filter((c): c is string => !!c),
    ),
  ).sort();

  function handleSubmit() {
    startTransition(async () => {
      const result = await updateTransactionOverridesAction({
        transactionId: transaction.id,
        customName: nickname.trim() === "" ? null : nickname,
        customCategory: category === NONE_CATEGORY ? null : category,
      });
      if (result.success) {
        toast.success(
          transaction.recurringStreamId
            ? "Updated all recurrences"
            : "Transaction updated",
        );
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit transaction</DialogTitle>
          <DialogDescription>
            {transaction.recurringStreamId
              ? "Changes apply to all past and future occurrences of this recurring transaction."
              : "Override the name and category for this transaction."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="nickname">Nickname</Label>
              {nickname && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-0 text-xs"
                  onClick={() => setNickname("")}
                >
                  <RotateCcw className="size-3" />
                  Reset
                </Button>
              )}
            </div>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={plaidName}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              Original: {plaidName}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="category">Category</Label>
              {category !== NONE_CATEGORY && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-0 text-xs"
                  onClick={() => setCategory(NONE_CATEGORY)}
                >
                  <RotateCcw className="size-3" />
                  Reset
                </Button>
              )}
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Use original category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_CATEGORY}>
                  Use original category
                </SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {formatCategory(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {plaidCategory && (
              <p className="text-xs text-muted-foreground">
                Original: {formatCategory(plaidCategory)}
              </p>
            )}
          </div>

          {parseFloat(transaction.amount) > 0 && (
            <div className="space-y-2">
              <Label>Spending type</Label>
              <div>
                <ClassifyPopover
                  transactionId={transaction.id}
                  spendingType={transaction.spendingType}
                  source={transaction.spendingTypeSource}
                  recurringStreamId={transaction.recurringStreamId}
                  normalizedMerchant={transaction.normalizedMerchant}
                  nameSignature={transaction.nameSignature}
                  merchantDisplay={
                    displayName({
                      customName: transaction.customName,
                      merchantName: transaction.merchantName,
                    }) || transaction.name
                  }
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
