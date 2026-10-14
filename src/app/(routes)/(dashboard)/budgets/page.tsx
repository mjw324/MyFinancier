import { type Metadata } from "next";
import { PiggyBank } from "lucide-react";
import { getServerSession } from "@/lib/auth/get-session";
import { getBudgetProgress } from "@/lib/db/queries/budgets";
import { getBudgetCategoryOptions } from "@/lib/db/queries/categories";
import { getUserToday } from "@/lib/utils/user-time";
import { toYmd } from "@/lib/utils/budget-periods";
import { BudgetCard } from "@/components/features/budgets/budget-card";
import { CreateBudgetDialog } from "@/components/features/budgets/create-budget-dialog";

export const metadata: Metadata = {
  title: "MyFinancier — Budgets",
};

export default async function BudgetsPage() {
  const session = await getServerSession();
  const userId = session!.user.id;
  const todayDate = await getUserToday();
  const today = toYmd(todayDate);

  const [budgets, categories] = await Promise.all([
    getBudgetProgress(userId, todayDate),
    getBudgetCategoryOptions(userId),
  ]);
  const activeCount = budgets.filter((b) => b.window.state === "active").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Budgets</h2>
          <p className="text-sm text-muted-foreground">
            {activeCount} active budget{activeCount !== 1 ? "s" : ""}
            {budgets.length > activeCount && ` · ${budgets.length - activeCount} upcoming or ended`}
          </p>
        </div>
        <CreateBudgetDialog categories={categories} today={today} />
      </div>

      {budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-12 text-center">
          <PiggyBank className="size-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">No budgets yet</h3>
          <p className="mb-2 text-sm text-muted-foreground">
            Set a limit for a category and track spending against it each period.
          </p>
          <CreateBudgetDialog categories={categories} today={today} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => (
            <BudgetCard
              key={budget.budgetId}
              budget={budget}
              categories={categories}
              today={today}
            />
          ))}
        </div>
      )}
    </div>
  );
}
