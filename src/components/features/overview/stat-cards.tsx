import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Landmark,
} from "lucide-react";

interface StatCardsProps {
  netWorth: number;
  incomeThisMonth: number;
  expensesThisMonth: number;
  accountCount: number;
  rangeLabel?: string;
}

export function StatCards({
  netWorth,
  incomeThisMonth,
  expensesThisMonth,
  accountCount,
  rangeLabel,
}: StatCardsProps) {
  const stats = [
    // TODO: One extra line insights for net worth, income, and expenses
    // This could be rolling average/how these markers has changed since last period
    {
      title: "Net Worth",
      value: formatCurrency(netWorth),
      icon: DollarSign,
      gradient: "from-blue-600 to-indigo-700",
    },
    {
      title: "Income",
      value: formatCurrency(incomeThisMonth),
      description: rangeLabel ?? "This month",
      icon: TrendingUp,
      gradient: "from-emerald-500 to-green-700",
    },
    {
      title: "Expenses",
      value: formatCurrency(expensesThisMonth),
      description: rangeLabel ?? "This month",
      icon: TrendingDown,
      gradient: "from-rose-500 to-red-700",
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
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
