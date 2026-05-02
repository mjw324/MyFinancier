"use client";

import { useState, useTransition } from "react";
import {
  getDashboardDataByRange,
  type DashboardRangeData,
} from "@/app/(routes)/(dashboard)/actions";
import { SpendingTimeRangeSelect } from "./spending-time-range-select";
import { StatCards } from "./stat-cards";
import { RecentTransactions } from "./recent-transactions";
import { SpendingOverTime } from "@/components/charts/spending-over-time";
import { SpendingByCategory } from "@/components/charts/spending-by-category";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SafeToSpend } from "@/components/features/recurring/safe-to-spend";
import { BillCalendar } from "@/components/features/recurring/bill-calendar";
import { NecessaryVsDiscretionary } from "./necessary-vs-discretionary";

const RANGE_LABELS: Record<string, string> = {
  week: "Past week",
  month: "Past month",
  year: "Past year",
  ytd: "Year to date",
};

interface DashboardContentProps {
  netWorth: number;
  projectedNetWorth: number;
  pendingIncomeThisMonth: number;
  pendingExpensesThisMonth: number;
  initialRangeData: DashboardRangeData | null;
  children: React.ReactNode;
}

export function DashboardContent({
  netWorth,
  projectedNetWorth,
  pendingIncomeThisMonth,
  pendingExpensesThisMonth,
  initialRangeData,
  children,
}: DashboardContentProps) {
  const [range, setRange] = useState("month");
  const [rangeData, setRangeData] = useState(initialRangeData);
  const [isPending, startTransition] = useTransition();

  function handleRangeChange(newRange: string) {
    setRange(newRange);
    startTransition(async () => {
      const result = await getDashboardDataByRange(newRange);
      if (result.success) {
        setRangeData(result.data);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Overview</h2>
        <SpendingTimeRangeSelect
          value={range}
          onValueChange={handleRangeChange}
          disabled={isPending}
        />
      </div>

      <div className={isPending ? "opacity-50 transition-opacity" : ""}>
        <StatCards
          netWorth={netWorth}
          projectedNetWorth={projectedNetWorth}
          incomeThisMonth={rangeData?.income ?? 0}
          expensesThisMonth={rangeData?.expenses ?? 0}
          pendingIncomeThisMonth={pendingIncomeThisMonth}
          pendingExpensesThisMonth={pendingExpensesThisMonth}
          netWorthDelta={rangeData?.netWorthDelta ?? 0}
          previousIncome={rangeData?.previousIncome ?? 0}
          previousExpenses={rangeData?.previousExpenses ?? 0}
          rangeLabel={RANGE_LABELS[range]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <SafeToSpend />
        </div>
        <div className="lg:col-span-2">
          <BillCalendar />
        </div>
      </div>

      <div
        className={`grid gap-6 lg:grid-cols-2${isPending ? " opacity-50 transition-opacity" : ""}`}
      >
        <RecentTransactions
          transactions={rangeData?.recentTransactions ?? []}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spending by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendingByCategory
              data={rangeData?.spendingByCategory ?? []}
            />
          </CardContent>
        </Card>
      </div>

      {rangeData?.spendingTypeTotals && (
        <div className={isPending ? "opacity-50 transition-opacity" : ""}>
          <NecessaryVsDiscretionary
            totals={rangeData.spendingTypeTotals}
            percentages={rangeData.spendingTypePercentages}
          />
        </div>
      )}

      <Card className={isPending ? "opacity-50 transition-opacity" : ""}>
        <CardHeader>
          <CardTitle className="text-base">Spending Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <SpendingOverTime data={rangeData?.spendingOverTime ?? []} />
        </CardContent>
      </Card>

      {children}
    </div>
  );
}
