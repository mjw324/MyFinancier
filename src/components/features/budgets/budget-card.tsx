import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatCurrency } from "@/lib/utils/format";
import { formatBudgetPercentage } from "@/lib/utils/calculations";
import { cn } from "@/lib/utils";
import type { BudgetProgress } from "@/lib/db/queries/budgets";
import type { BudgetCategoryOption } from "@/lib/budgets/categories";
import { EditBudgetDialog } from "./edit-budget-dialog";

interface BudgetCardProps {
  budget: BudgetProgress;
  categories: BudgetCategoryOption[];
  today: string;
}

const PERIOD_LABEL = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" } as const;

export function BudgetCard({ budget, categories, today }: BudgetCardProps) {
  const { status, window: w } = budget;
  const over = status === "over";
  const netRefund = budget.spent < 0;
  const shownSpent = Math.max(budget.spent, 0);
  const progress = Math.min(Math.max(budget.percentage, 0), 100);

  let windowNote: string;
  if (w.state === "upcoming") windowNote = `Starts ${w.label.split(" – ")[0]}`;
  else if (w.state === "ended") windowNote = `Ended · last period ${w.label}`;
  else windowNote = `${w.label} · ${w.daysLeft} day${w.daysLeft === 1 ? "" : "s"} left`;

  return (
    <Card className={cn(w.state !== "active" && "opacity-80")}>
      <CardHeader>
        <CardTitle className="text-base">{budget.categoryLabel}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{PERIOD_LABEL[budget.period]}</Badge>
          {w.state !== "active" && (
            <Badge variant="outline">{w.state === "ended" ? "Ended" : "Upcoming"}</Badge>
          )}
          <span className="text-xs">{windowNote}</span>
        </CardDescription>
        <CardAction>
          <EditBudgetDialog budget={budget} categories={categories} today={today} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {formatCurrency(shownSpent)}
            </span>{" "}
            of {formatCurrency(budget.budgeted)}
          </span>
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              over ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {over
              ? `${formatCurrency(Math.abs(budget.remaining))} over`
              : `${formatCurrency(budget.remaining)} left`}
          </span>
        </div>
        <Progress
          value={progress}
          aria-label={`${formatBudgetPercentage(budget.spent, budget.budgeted)} of budget used`}
          className={cn("h-2", over && "[&>div]:bg-destructive")}
        />
        <p className="text-xs text-muted-foreground">
          {formatBudgetPercentage(budget.spent, budget.budgeted)} used
          {budget.offsets > 0 &&
            (netRefund
              ? ` · refunds of ${formatCurrency(budget.offsets)} exceed spending by ${formatCurrency(Math.abs(budget.spent))}`
              : ` · after ${formatCurrency(budget.offsets)} in refunds`)}
        </p>
      </CardContent>
    </Card>
  );
}
