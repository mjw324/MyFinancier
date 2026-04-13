"use server";

import { z } from "zod";
import { getServerSession } from "@/lib/auth/get-session";
import { getTransactionsByDateRange } from "@/lib/db/queries/transactions";
import { formatCategory } from "@/lib/utils/format";

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

function getDateRange(range: SpendingRange): { start: Date; end: Date } {
  const now = new Date();
  switch (range) {
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    case "month": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    case "year": {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1), end: now };
  }
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
  const transactions = await getTransactionsByDateRange(
    session.user.id,
    start,
    end,
  );

  // Single pass: compute income, expenses, category breakdown, and time series
  let income = 0;
  let expenses = 0;
  const categoryTotals = new Map<string, number>();
  const dailyTotals = new Map<string, number>();
  const dailyDates = new Map<string, Date>();

  for (const txn of transactions) {
    const amount = parseFloat(txn.amount);
    if (amount > 0) {
      expenses += amount;
      // Category breakdown (expenses only)
      const cat = txn.category ?? "UNCATEGORIZED";
      categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + amount);
      // Daily time series (expenses only)
      const d = txn.date;
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      dailyTotals.set(dayKey, (dailyTotals.get(dayKey) ?? 0) + amount);
      if (!dailyDates.has(dayKey)) dailyDates.set(dayKey, d);
    } else if (amount < 0) {
      income += Math.abs(amount);
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
      spendingByCategory,
      spendingOverTime,
      recentTransactions,
    },
  };
}
