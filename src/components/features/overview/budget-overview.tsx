import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, getCategoryColor } from "@/lib/utils/format";
import { calculateBudgetPercentage } from "@/lib/utils/calculations";
import { cn } from "@/lib/utils";

interface BudgetItem {
  budgetId: string;
  categoryName: string;
  budgeted: number;
  spent: number;
  period: string;
}

interface BudgetOverviewProps {
  budgets: BudgetItem[];
}

export function BudgetOverview({ budgets }: BudgetOverviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Budget Progress</CardTitle>
      </CardHeader>
      <CardContent>
        {budgets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No budgets set up yet</p>
        ) : (
          <div className="space-y-4">
            {budgets.map((budget) => {
              const percentage = calculateBudgetPercentage(
                budget.spent,
                budget.budgeted,
              );
              const isOverBudget = percentage > 100;
              return (
                <div key={budget.budgetId} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span
                      className="font-medium"
                      style={{ color: getCategoryColor(budget.categoryName).text }}
                    >
                      {budget.categoryName}
                    </span>
                    <span
                      className={cn(
                        "text-muted-foreground",
                        isOverBudget && "text-destructive font-medium",
                      )}
                    >
                      {formatCurrency(budget.spent)} /{" "}
                      {formatCurrency(budget.budgeted)}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(percentage, 100)}
                    className={cn(
                      "h-2",
                      isOverBudget &&
                        "[&>div]:bg-destructive",
                    )}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
