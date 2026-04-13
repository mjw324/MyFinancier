import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, getCategoryColor } from "@/lib/utils/format";
import { calculateBudgetPercentage } from "@/lib/utils/calculations";
import { cn } from "@/lib/utils";
import { EditBudgetDialog } from "./edit-budget-dialog";

interface BudgetCardProps {
  budget: {
    budgetId: string;
    categoryId: string;
    categoryName: string;
    budgeted: number;
    spent: number;
    period: string;
    startDate: string;
  };
  categories: Array<{ id: string; name: string }>;
}

export function BudgetCard({ budget, categories }: BudgetCardProps) {
  const percentage = calculateBudgetPercentage(budget.spent, budget.budgeted);
  const isOverBudget = percentage > 100;
  const remaining = budget.budgeted - budget.spent;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <p
              className="text-base font-semibold"
              style={{ color: getCategoryColor(budget.categoryName).text }}
            >
              {budget.categoryName}
            </p>
            <Badge variant="secondary" className="mt-1 text-xs capitalize">
              {budget.period}
            </Badge>
          </div>
          <EditBudgetDialog budget={budget} categories={categories} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between text-sm">
          <span className="text-muted-foreground">
            {formatCurrency(budget.spent)} of {formatCurrency(budget.budgeted)}
          </span>
          <span
            className={cn(
              "text-xs font-medium",
              isOverBudget ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {isOverBudget
              ? `${formatCurrency(Math.abs(remaining))} over`
              : `${formatCurrency(remaining)} left`}
          </span>
        </div>
        <Progress
          value={Math.min(percentage, 100)}
          className={cn(
            "h-2",
            isOverBudget && "[&>div]:bg-destructive",
          )}
        />
      </CardContent>
    </Card>
  );
}
