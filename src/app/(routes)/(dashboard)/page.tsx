import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/get-session";
import {
  getOverviewStats,
  getBudgetProgress,
} from "@/lib/db/queries/overview";
import { DashboardContent } from "@/components/features/overview/dashboard-content";
import { BudgetOverview } from "@/components/features/overview/budget-overview";
import { getDashboardDataByRange } from "./actions";

export const metadata: Metadata = {
  title: "MyFinancier — Dashboard",
};

export default async function OverviewPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/signin");
  const userId = session.user.id;

  const [stats, dashboardResult, budgetProgress] = await Promise.all([
    getOverviewStats(userId),
    getDashboardDataByRange("month"),
    getBudgetProgress(userId),
  ]);

  return (
    <DashboardContent
      netWorth={stats.netWorth}
      initialRangeData={dashboardResult.success ? dashboardResult.data : null}
    >
      <BudgetOverview budgets={budgetProgress} />
    </DashboardContent>
  );
}
