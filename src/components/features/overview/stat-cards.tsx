import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatCompactCurrency } from "@/lib/utils/format";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Landmark,
  type LucideIcon,
} from "lucide-react";

interface StatCardsProps {
  netWorth: number;
  incomeThisMonth: number;
  expensesThisMonth: number;
  netWorthDelta: number;
  previousIncome: number;
  previousExpenses: number;
  accountCount: number;
  rangeLabel?: string;
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

interface TrendIndicatorProps {
  delta: number;
  label: string;
  invertColor?: boolean;
}

function TrendIndicator({ delta, label, invertColor }: TrendIndicatorProps) {
  const isPositive = delta > 0;
  // For expenses, "up" is bad (red) and "down" is good (green)
  const isGood = invertColor ? !isPositive : isPositive;
  const Icon = isPositive ? TrendingUp : TrendingDown;

  return (
    <p className="flex items-center gap-1 text-xs text-white/80">
      <Icon className={`size-3.5 ${isGood ? "text-emerald-300" : "text-red-300"}`} />
      <span>{label}</span>
    </p>
  );
}

interface StatConfig {
  title: string;
  value: string;
  description?: string;
  trend?: { delta: number; label: string; invertColor?: boolean } | null;
  icon: LucideIcon;
  gradient: string;
}

export function StatCards({
  netWorth,
  incomeThisMonth,
  expensesThisMonth,
  netWorthDelta,
  previousIncome,
  previousExpenses,
  accountCount,
  rangeLabel,
}: StatCardsProps) {
  const incomePctChange = percentChange(incomeThisMonth, previousIncome);
  const expensesPctChange = percentChange(expensesThisMonth, previousExpenses);

  const stats: StatConfig[] = [
    {
      title: "Net Worth",
      value: formatCurrency(netWorth),
      icon: DollarSign,
      gradient: "from-blue-600 to-indigo-700",
      trend: netWorthDelta !== 0
        ? {
            delta: netWorthDelta,
            label: `${netWorthDelta > 0 ? "+" : ""}${formatCompactCurrency(netWorthDelta)} ${(rangeLabel ?? "this month").toLowerCase()}`,
          }
        : null,
    },
    // TODO: Fix "Down 0% vs prev period"
    // TODO: Hone in/re-explore what would be most useful for user as a secondary metric - what if it was a vertical bar that represented how much expenses we have left (projected or budget?) for the period.
    // TODO: We should have a button (+ icon) to set/add recurring income or expenses in order to better build budgets/planning
    // Would be ideal if recurring income/expenses tied into budgets
    {
      title: "Income",
      value: formatCurrency(incomeThisMonth),
      description: rangeLabel ?? "This month",
      icon: TrendingUp,
      gradient: "from-emerald-500 to-green-700",
      trend: incomePctChange !== null
        ? {
            delta: incomePctChange,
            label: `${Math.abs(incomePctChange)}% vs prev period`,
          }
        : previousIncome === 0 && incomeThisMonth > 0
          ? { delta: 1, label: "New this period" }
          : null,
    },
    {
      title: "Expenses",
      value: formatCurrency(expensesThisMonth),
      description: rangeLabel ?? "This month",
      icon: TrendingDown,
      gradient: "from-rose-500 to-red-700",
      trend: expensesPctChange !== null
        ? {
            delta: expensesPctChange,
            label: `${Math.abs(expensesPctChange)}% vs prev period`,
            invertColor: true,
          }
        : previousExpenses === 0 && expensesThisMonth > 0
          ? { delta: 1, label: "New this period", invertColor: true }
          : null,
    },
    // TODO: Make Accounts have icons referring to the first 5 accounts, icons/colors should be relevant (different bank companies, etc)
    {
      title: "Accounts",
      value: accountCount.toString(),
      description: "Linked",
      icon: Landmark,
      gradient: "from-violet-500 to-purple-700",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title} className={`bg-gradient-to-br ${stat.gradient} border-0`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-white/90">{stat.title}</CardTitle>
            <stat.icon className="size-5 text-white stroke-[2.5]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
            {stat.description && (
              <p className="text-xs text-white/70">
                {stat.description}
              </p>
            )}
            {stat.trend && (
              <TrendIndicator
                delta={stat.trend.delta}
                label={stat.trend.label}
                invertColor={stat.trend.invertColor}
              />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
