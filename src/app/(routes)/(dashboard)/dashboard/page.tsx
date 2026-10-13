import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/get-session";
import { getBudgetProgress } from "@/lib/db/queries/overview";
import { BudgetOverview } from "@/components/features/overview/budget-overview";
import { RecentTransactions } from "@/components/features/overview/recent-transactions";
import { getUserToday } from "@/lib/utils/user-time";
import { toDateParam } from "@/lib/utils/date-ranges";
import { loadRecent } from "./data";

export const metadata: Metadata = {
  title: "MyFinancier — Dashboard",
};

// Interim page while the cash-flow dashboard is assembled (next commit).
export default async function OverviewPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/signin");
  const userId = session.user.id;
  const today = toDateParam(await getUserToday());

  const [recent, budgetProgress] = await Promise.all([
    loadRecent(userId),
    getBudgetProgress(userId),
  ]);

  return (
    <div className="flex flex-col gap-6" data-today={today}>
      <RecentTransactions transactions={recent} />
      <BudgetOverview budgets={budgetProgress} />
    </div>
  );
}
