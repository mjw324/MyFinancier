"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BudgetCategoryOption } from "@/lib/budgets/categories";
import { spendBucketLabel } from "@/lib/budgets/categories";
import { defaultBudgetStart, toYmd, type BudgetPeriod } from "@/lib/utils/budget-periods";

export interface BudgetFormValues {
  categoryKey: string;
  amount: string;
  period: BudgetPeriod;
  startDate: string;
  endDate: string;
}

interface BudgetFormProps {
  categories: BudgetCategoryOption[];
  /** The viewer's calendar date "YYYY-MM-DD" (for default start dates). */
  today: string;
  initial?: Partial<BudgetFormValues>;
  submitLabel: string;
  pendingLabel: string;
  isPending: boolean;
  onSubmit: (values: BudgetFormValues) => void;
  onCancel: () => void;
  /** Extra controls on the left of the footer (e.g. Delete). */
  footerStart?: ReactNode;
}

const GROUPS: Array<{ group: BudgetCategoryOption["group"]; label: string }> = [
  { group: "category", label: "Spending categories" },
  { group: "custom", label: "Your categories" },
  { group: "other", label: "Cash & people" },
];

const PERIOD_LABELS: Record<BudgetPeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function startFor(period: BudgetPeriod, today: string): string {
  return toYmd(defaultBudgetStart(period, new Date(`${today}T00:00:00Z`)));
}

export function BudgetForm({
  categories,
  today,
  initial,
  submitLabel,
  pendingLabel,
  isPending,
  onSubmit,
  onCancel,
  footerStart,
}: BudgetFormProps) {
  const id = useId();
  const initialPeriod = initial?.period ?? "monthly";
  const [categoryKey, setCategoryKey] = useState(initial?.categoryKey ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [period, setPeriod] = useState<BudgetPeriod>(initialPeriod);
  const [startDate, setStartDate] = useState(
    initial?.startDate ?? startFor(initialPeriod, today),
  );
  const [startTouched, setStartTouched] = useState(Boolean(initial?.startDate));
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");

  // Keep the current key selectable even if it is no longer in the list.
  const options =
    categoryKey && !categories.some((c) => c.key === categoryKey)
      ? [...categories, { key: categoryKey, label: spendBucketLabel(categoryKey), group: "custom" as const }]
      : categories;

  function changePeriod(next: BudgetPeriod) {
    setPeriod(next);
    if (!startTouched) setStartDate(startFor(next, today));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ categoryKey, amount, period, startDate, endDate });
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-category`}>Category</Label>
        <Select value={categoryKey} onValueChange={setCategoryKey}>
          <SelectTrigger id={`${id}-category`} className="w-full">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map(({ group, label }) => {
              const items = options.filter((o) => o.group === group);
              if (items.length === 0) return null;
              return (
                <SelectGroup key={group}>
                  <SelectLabel>{label}</SelectLabel>
                  {items.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-amount`}>Amount</Label>
          <Input
            id={`${id}-amount`}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-period`}>Period</Label>
          <Select value={period} onValueChange={(v) => changePeriod(v as BudgetPeriod)}>
            <SelectTrigger id={`${id}-period`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(Object.keys(PERIOD_LABELS) as BudgetPeriod[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-start`}>Starts</Label>
          <Input
            id={`${id}-start`}
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartTouched(true);
              setStartDate(e.target.value);
            }}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-end`}>Ends (optional)</Label>
          <Input
            id={`${id}-end`}
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Each period starts on the same day as the start date — pick the 1st
        for calendar months.
      </p>

      <div className="flex items-center justify-between gap-2">
        <div>{footerStart}</div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || !categoryKey || !amount}>
            {isPending ? pendingLabel : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
