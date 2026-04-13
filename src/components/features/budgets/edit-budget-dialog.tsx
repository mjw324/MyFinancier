"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Pencil } from "lucide-react";
import {
  updateBudgetAction,
  deleteBudgetAction,
} from "@/app/(routes)/(dashboard)/budgets/actions";

interface EditBudgetDialogProps {
  budget: {
    budgetId: string;
    categoryId: string;
    categoryName: string;
    budgeted: number;
    period: string;
    startDate: string;
  };
  categories: Array<{ id: string; name: string }>;
}

export function EditBudgetDialog({
  budget,
  categories,
}: EditBudgetDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [categoryId, setCategoryId] = useState(budget.categoryId);
  const [amount, setAmount] = useState(budget.budgeted.toString());
  const [period, setPeriod] = useState(budget.period);
  const [startDate, setStartDate] = useState(budget.startDate);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateBudgetAction({
        budgetId: budget.budgetId,
        categoryId,
        amount,
        period,
        startDate,
      });
      if (result.success) {
        toast.success("Budget updated");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Budget</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`category-${budget.budgetId}`}>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id={`category-${budget.budgetId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`amount-${budget.budgetId}`}>Amount</Label>
            <Input
              id={`amount-${budget.budgetId}`}
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`period-${budget.budgetId}`}>Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger id={`period-${budget.budgetId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`startDate-${budget.budgetId}`}>Start Date</Label>
            <Input
              id={`startDate-${budget.budgetId}`}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

          <div className="flex justify-between">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
            >
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending || !categoryId || !amount}
              >
                {isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
