import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "..";
import { financialAccounts, transactions } from "../schema";
import {
  projectedBalance,
  netWorthContribution,
} from "@/lib/utils/balances";

export interface PendingTxnPreview {
  id: string;
  name: string;
  merchantName: string | null;
  customName: string | null;
  amount: string;
  date: Date;
}

export async function getAccountsByUserId(userId: string) {
  return db.query.financialAccounts.findMany({
    where: eq(financialAccounts.userId, userId),
    with: { plaidItem: true },
  });
}

export async function getAccountById(id: string) {
  return db.query.financialAccounts.findFirst({
    where: eq(financialAccounts.id, id),
    with: { plaidItem: true },
  });
}

export async function getAccountByPlaidAccountId(plaidAccountId: string) {
  return db.query.financialAccounts.findFirst({
    where: eq(financialAccounts.plaidAccountId, plaidAccountId),
  });
}

export type AccountWithBalances = Awaited<
  ReturnType<typeof getAccountsByUserId>
>[number] & {
  settledBalance: number;
  projectedBalance: number;
  netWorthSettled: number;
  netWorthProjected: number;
  pendingCount: number;
  pendingSum: number;
  pendingTransactions: PendingTxnPreview[];
};

/**
 * Returns accounts with both settled (currentBalance) and projected
 * (currentBalance ± Σ pending) balances computed per account, plus the
 * count and sum of pending transactions used to derive them.
 */
export async function getAccountsWithBalances(
  userId: string,
): Promise<AccountWithBalances[]> {
  const accounts = await getAccountsByUserId(userId);
  if (accounts.length === 0) return [];

  const pendingTxns = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      name: transactions.name,
      merchantName: transactions.merchantName,
      customName: transactions.customName,
      amount: transactions.amount,
      date: transactions.date,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.pending, true),
      ),
    )
    .orderBy(asc(transactions.date));

  const pendingByAccount = new Map<
    string,
    { sum: number; count: number; txns: PendingTxnPreview[] }
  >();
  for (const t of pendingTxns) {
    const entry =
      pendingByAccount.get(t.accountId) ??
      { sum: 0, count: 0, txns: [] as PendingTxnPreview[] };
    entry.sum += parseFloat(t.amount) || 0;
    entry.count += 1;
    entry.txns.push({
      id: t.id,
      name: t.name,
      merchantName: t.merchantName,
      customName: t.customName,
      amount: t.amount,
      date: t.date,
    });
    pendingByAccount.set(t.accountId, entry);
  }

  return accounts.map((acc) => {
    const p = pendingByAccount.get(acc.id);
    const pendingSum = p?.sum ?? 0;
    const pendingCount = p?.count ?? 0;
    const settled = parseFloat(acc.currentBalance ?? "0") || 0;
    const projected = projectedBalance(acc.type, acc.currentBalance, pendingSum);
    return {
      ...acc,
      settledBalance: settled,
      projectedBalance: projected,
      netWorthSettled: netWorthContribution(acc.type, settled),
      netWorthProjected: netWorthContribution(acc.type, projected),
      pendingCount,
      pendingSum,
      pendingTransactions: p?.txns ?? [],
    };
  });
}
