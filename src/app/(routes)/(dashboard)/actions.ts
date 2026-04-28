"use server";

import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { getTransactionsByDateRange } from "@/lib/db/queries/transactions";
import { formatCategory } from "@/lib/utils/format";
import { aggregateIncomeAndExpenses } from "@/lib/utils/aggregations";
import { getDateRange, getPreviousDateRange } from "@/lib/utils/date-ranges";

const rangeSchema = z.enum(["week", "month", "year", "ytd"]);

export type SpendingRange = z.infer<typeof rangeSchema>;

export interface SpendingDataPoint {
  date: string;
  rawDate: string;
  amount: number;
}

export interface DashboardRangeData {
  income: number;
  expenses: number;
  netWorthDelta: number;
  previousIncome: number;
  previousExpenses: number;
  spendingByCategory: Array<{
    category: string;
    rawCategory: string;
    amount: number;
  }>;
  spendingOverTime: SpendingDataPoint[];
  recentTransactions: Array<{
    id: string;
    name: string;
    merchantName: string | null;
    amount: string;
    date: string;
    category: string | null;
  }>;
}

export async function getDashboardDataByRange(
  range: string,
): Promise<
  { success: true; data: DashboardRangeData } | { success: false; error: string }
> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };

  const parsed = rangeSchema.safeParse(range);
  if (!parsed.success) return { success: false, error: "Invalid range" };

  const { start, end } = getDateRange(parsed.data);
  const prev = getPreviousDateRange(parsed.data);
  const [transactions, prevTransactions] = await Promise.all([
    getTransactionsByDateRange(session.user.id, start, end),
    getTransactionsByDateRange(session.user.id, prev.start, prev.end),
  ]);

  // Income & expenses (current + previous period) via shared pure helper
  const { income, expenses } = aggregateIncomeAndExpenses(transactions);
  const { income: previousIncome, expenses: previousExpenses } =
    aggregateIncomeAndExpenses(prevTransactions);

  // Category breakdown + daily time series (expenses only)
  const categoryTotals = new Map<string, number>();
  const dailyTotals = new Map<string, number>();
  const dailyDates = new Map<string, Date>();

  for (const txn of transactions) {
    const amount = parseFloat(txn.amount);
    if (amount > 0) {
      const cat = txn.category ?? "UNCATEGORIZED";
      categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + amount);
      const d = txn.date;
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      dailyTotals.set(dayKey, (dailyTotals.get(dayKey) ?? 0) + amount);
      if (!dailyDates.has(dayKey)) dailyDates.set(dayKey, d);
    }
  }

  // Format spending by category
  const spendingByCategory = Array.from(categoryTotals.entries())
    .map(([cat, total]) => ({
      category: formatCategory(cat),
      rawCategory: cat,
      amount: Math.round(total * 100) / 100,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Format spending over time
  const spendingOverTime = Array.from(dailyTotals.entries())
    .map(([key, total]) => {
      const d = dailyDates.get(key)!;
      const rawDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return {
        sortKey: d.getTime(),
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        rawDate,
        amount: Math.round(total * 100) / 100,
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ date, rawDate, amount }) => ({ date, rawDate, amount }));

  // Recent transactions (already sorted desc by date from query)
  const recentTransactions = transactions.slice(0, 10).map((txn) => ({
    id: txn.id,
    name: txn.name,
    merchantName: txn.merchantName,
    amount: txn.amount,
    date: txn.date.toISOString(),
    category: txn.category,
  }));

  return {
    success: true,
    data: {
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      netWorthDelta: Math.round((income - expenses) * 100) / 100,
      previousIncome: Math.round(previousIncome * 100) / 100,
      previousExpenses: Math.round(previousExpenses * 100) / 100,
      spendingByCategory,
      spendingOverTime,
      recentTransactions,
    },
  };
}
