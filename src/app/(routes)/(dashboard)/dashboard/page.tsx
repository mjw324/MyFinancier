import { Suspense } from "react";
import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/get-session";
import { getUserToday } from "@/lib/utils/user-time";
import { dashboardPeriodSchema, toDateParam } from "@/lib/utils/date-ranges";
import { PeriodSelect } from "@/components/features/overview/period-select";
import { WidgetSkeleton } from "@/components/features/overview/widget-states";
import { SafeToSpend } from "@/components/features/recurring/safe-to-spend";
import { BillCalendar } from "@/components/features/recurring/bill-calendar";
import type { DashboardContext } from "./data";
import {
  BalanceWidget,
  BudgetWidget,
  CashFlowWidget,
  FixedVariableWidget,
  InsightsWidget,
  PaceWidget,
  RecentWidget,
  SpendingOverTimeWidget,
  WhereItWentWidget,
} from "./_components/widgets";

export const metadata: Metadata = {
  title: "MyFinancier — Dashboard",
};

/**
 * Cash-flow dashboard. Every money figure comes from
 * src/lib/analytics/metrics.ts — the same functions behind the transactions
 * totals bar and the export — scoped to one period chosen above everything it
 * affects. "Today" is the viewer's calendar date, not the server's.
 *
 * Widgets stream independently; a failing query degrades its own card.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session?.user) redirect("/signin");

  const params = await searchParams;
  const raw = Array.isArray(params.period) ? params.period[0] : params.period;
  const ctx: DashboardContext = {
    userId: session.user.id,
    key: dashboardPeriodSchema.parse(raw),
    today: toDateParam(await getUserToday()),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Overview</h2>
        <PeriodSelect value={ctx.key} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <Suspense fallback={<WidgetSkeleton title="Cash flow" height="h-48" />}>
            <CashFlowWidget ctx={ctx} />
          </Suspense>
        </div>
        <div className="min-w-0">
          <Suspense fallback={<WidgetSkeleton title="Net worth" height="h-48" />}>
            <BalanceWidget ctx={ctx} />
          </Suspense>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <Suspense fallback={<WidgetSkeleton title="Where it went" height="h-72" />}>
            <WhereItWentWidget ctx={ctx} />
          </Suspense>
        </div>
        <div className="min-w-0">
          <Suspense fallback={<WidgetSkeleton title="What changed" height="h-72" />}>
            <InsightsWidget ctx={ctx} />
          </Suspense>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <Suspense fallback={<WidgetSkeleton title="Pace" height="h-72" />}>
            <PaceWidget ctx={ctx} />
          </Suspense>
        </div>
        <div className="min-w-0">
          <Suspense fallback={<WidgetSkeleton title="Fixed vs variable" height="h-72" />}>
            <FixedVariableWidget ctx={ctx} />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<WidgetSkeleton title="Daily spending" height="h-60" />}>
        <SpendingOverTimeWidget ctx={ctx} />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-1">
          <SafeToSpend />
        </div>
        <div className="min-w-0 xl:col-span-2">
          <BillCalendar />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <Suspense fallback={<WidgetSkeleton title="Recent transactions" height="h-72" />}>
            <RecentWidget ctx={ctx} />
          </Suspense>
        </div>
        <div className="min-w-0">
          <Suspense fallback={<WidgetSkeleton title="Budget progress" height="h-40" />}>
            <BudgetWidget ctx={ctx} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
