import { type Metadata } from "next";
import { getServerSession } from "@/lib/auth/get-session";
import { getBudgetProgress } from "@/lib/db/queries/overview";
import { getCategoriesByUserId } from "@/lib/db/queries/categories";
import { BudgetCard } from "@/components/features/budgets/budget-card";
import { CreateBudgetDialog } from "@/components/features/budgets/create-budget-dialog";
import { PiggyBank } from "lucide-react";

export const metadata: Metadata = {
  title: "MyFinancier — Budgets",
};

export default async function BudgetsPage() {
  const session = await getServerSession();
  const userId = session!.user.id;

  const [budgets, categories] = await Promise.all([
    getBudgetProgress(userId),
    getCategoriesByUserId(userId),
  ]);

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Budgets</h2>
          <p className="text-sm text-muted-foreground">
            {budgets.length} budget{budgets.length !== 1 ? "s" : ""} active
          </p>
        </div>
        <CreateBudgetDialog categories={categoryOptions} />
      </div>

      {budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <PiggyBank className="mb-4 size-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">No budgets yet</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Create a budget to start tracking your spending
          </p>
          <CreateBudgetDialog categories={categoryOptions} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => (
            <BudgetCard
              key={budget.budgetId}
              budget={budget}
              categories={categoryOptions}
            />
          ))}
        </div>
      )}
    </div>
  );
}
