import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatCompactCurrency } from "@/lib/utils/format";
import { calculateSavingsRate } from "@/lib/utils/aggregations";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  PiggyBank,
  type LucideIcon,
} from "lucide-react";

interface StatCardsProps {
  netWorth: number;
  incomeThisMonth: number;
  expensesThisMonth: number;
  netWorthDelta: number;
  previousIncome: number;
  previousExpenses: number;
  rangeLabel?: string;
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  return change === 0 ? null : change;
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
  rangeLabel,
}: StatCardsProps) {
  const incomePctChange = percentChange(incomeThisMonth, previousIncome);
  const expensesPctChange = percentChange(expensesThisMonth, previousExpenses);

  // Derived metrics
  const cashFlow = incomeThisMonth - expensesThisMonth;
  const savingsRate = calculateSavingsRate(incomeThisMonth, expensesThisMonth);
  const previousSavingsRate = calculateSavingsRate(previousIncome, previousExpenses);

  const savingsRateDelta =
    savingsRate !== null && previousSavingsRate !== null
      ? savingsRate - previousSavingsRate
      : null;

  const expenseRatio = incomeThisMonth > 0
    ? Math.round((expensesThisMonth / incomeThisMonth) * 100)
    : null;

  // Savings rate description
  let savingsDescription: string;
  if (savingsRate === null) {
    savingsDescription = "No income recorded";
  } else if (cashFlow > 0) {
    savingsDescription = `${formatCompactCurrency(cashFlow)} saved`;
  } else if (cashFlow < 0) {
    savingsDescription = `${formatCompactCurrency(Math.abs(cashFlow))} overspent`;
  } else {
    savingsDescription = "Breaking even";
  }

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
      description: expenseRatio !== null
        ? `${expenseRatio}% of income`
        : rangeLabel ?? "This month",
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
    {
      title: "Savings Rate",
      value: savingsRate !== null ? `${savingsRate}%` : "—",
      description: savingsDescription,
      icon: PiggyBank,
      gradient: "from-amber-500 to-orange-700",
      trend: savingsRateDelta !== null && savingsRateDelta !== 0
        ? {
            delta: savingsRateDelta,
            label: `${Math.abs(savingsRateDelta)}% vs prev period`,
          }
        : null,
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
