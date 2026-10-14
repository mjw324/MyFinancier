"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createBudgetAction } from "@/app/(routes)/(dashboard)/budgets/actions";
import type { BudgetCategoryOption } from "@/lib/budgets/categories";
import { BudgetForm } from "./budget-form";

interface CreateBudgetDialogProps {
  categories: BudgetCategoryOption[];
  today: string;
}

export function CreateBudgetDialog({ categories, today }: CreateBudgetDialogProps) {
  const [open, setOpen] = useState(false);
  // Remount the form on every open so it starts clean.
  const [formKey, setFormKey] = useState(0);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setFormKey((k) => k + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          Create budget
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create budget</DialogTitle>
          <DialogDescription>
            Spending in the category counts against the budget; refunds and
            reimbursements in it bring it back down.
          </DialogDescription>
        </DialogHeader>
        <BudgetForm
          key={formKey}
          categories={categories}
          today={today}
          submitLabel="Create"
          pendingLabel="Creating…"
          isPending={isPending}
          onCancel={() => setOpen(false)}
          onSubmit={(values) =>
            startTransition(async () => {
              const result = await createBudgetAction(values);
              if (result.success) {
                toast.success("Budget created");
                setOpen(false);
                router.refresh();
              } else {
                toast.error(result.error);
              }
            })
          }
        />
      </DialogContent>
    </Dialog>
  );
}
