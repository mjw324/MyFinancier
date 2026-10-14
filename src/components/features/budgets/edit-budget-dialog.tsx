"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  deleteBudgetAction,
  updateBudgetAction,
} from "@/app/(routes)/(dashboard)/budgets/actions";
import type { BudgetCategoryOption } from "@/lib/budgets/categories";
import type { BudgetPeriod } from "@/lib/utils/budget-periods";
import { BudgetForm } from "./budget-form";

interface EditBudgetDialogProps {
  budget: {
    budgetId: string;
    categoryKey: string;
    categoryLabel: string;
    budgeted: number;
    period: BudgetPeriod;
    startDate: string;
    endDate: string | null;
  };
  categories: BudgetCategoryOption[];
  today: string;
}

export function EditBudgetDialog({ budget, categories, today }: EditBudgetDialogProps) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteBudgetAction(budget.budgetId);
      if (result.success) {
        toast.success("Budget deleted");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setFormKey((k) => k + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Edit ${budget.categoryLabel} budget`}
        >
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit budget</DialogTitle>
          <DialogDescription>{budget.categoryLabel}</DialogDescription>
        </DialogHeader>
        <BudgetForm
          key={formKey}
          categories={categories}
          today={today}
          initial={{
            categoryKey: budget.categoryKey,
            amount: budget.budgeted.toFixed(2),
            period: budget.period,
            startDate: budget.startDate,
            endDate: budget.endDate ?? "",
          }}
          submitLabel="Save"
          pendingLabel="Saving…"
          isPending={isPending}
          onCancel={() => setOpen(false)}
          onSubmit={(values) =>
            startTransition(async () => {
              const result = await updateBudgetAction({
                budgetId: budget.budgetId,
                ...values,
              });
              if (result.success) {
                toast.success("Budget updated");
                setOpen(false);
                router.refresh();
              } else {
                toast.error(result.error);
              }
            })
          }
          footerStart={
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
            >
              Delete
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
