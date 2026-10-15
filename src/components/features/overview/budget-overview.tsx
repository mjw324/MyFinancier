import Link from "next/link";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCurrency } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { BudgetProgress } from "@/lib/db/queries/budgets";

interface BudgetOverviewProps {
  budgets: BudgetProgress[];
}

export function BudgetOverview({ budgets }: BudgetOverviewProps) {
  const active = budgets.filter((b) => b.window.state === "active");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Budget progress</CardTitle>
        <CardAction>
          <Link href="/budgets" className="text-xs text-muted-foreground hover:underline">
            Manage
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active budgets.{" "}
            <Link href="/budgets" className="underline underline-offset-2">
              Create one
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {active.map((budget) => {
              const over = budget.status === "over";
              return (
                <div key={budget.budgetId} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{budget.categoryLabel}</span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums text-muted-foreground",
                        over && "font-medium text-destructive",
                      )}
                    >
                      {formatCurrency(Math.max(budget.spent, 0))} /{" "}
                      {formatCurrency(budget.budgeted)}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(Math.max(budget.percentage, 0), 100)}
                    className={cn("h-2", over && "[&>div]:bg-destructive")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {budget.window.label} ·{" "}
                    {over
                      ? `${formatCurrency(Math.abs(budget.remaining))} over`
                      : `${formatCurrency(budget.remaining)} left`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
