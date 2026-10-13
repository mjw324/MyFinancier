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

/**
 * Balance headline for the dashboard. Contract shared by the dashboard (W3)
 * and the balances work (W4, which owns the implementation).
 *
 * - netWorth: assets − liabilities over open accounts with a known balance.
 * - liquidCash: depository balances only (what you can spend).
 * - investments: null when any open investment account has no balance
 *   (Plaid Investments product not enabled) — render "unavailable", never 0.
 * - staleAccounts: open accounts whose balance is older than `staleAfterDays`.
 */
export interface BalanceSummary {
  netWorth: number;
  liquidCash: number;
  creditDebt: number;
  loanDebt: number;
  investments: number | null;
  asOf: Date | null;
  staleAccounts: Array<{ id: string; name: string; lastSyncedAt: Date | null }>;
  unavailableAccounts: Array<{ id: string; name: string; type: string }>;
}

export async function getBalanceSummary(
  userId: string,
  { staleAfterDays = 3 }: { staleAfterDays?: number } = {},
): Promise<BalanceSummary> {
  // Interim implementation (W4 replaces it): numeric sums in SQL over open accounts.
  const rows = await db
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      type: financialAccounts.type,
      balance: financialAccounts.currentBalance,
      lastSyncedAt: financialAccounts.lastSyncedAt,
    })
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.userId, userId),
        sql`${financialAccounts.closedAt} IS NULL`,
      ),
    );

  const cents = (v: string | null) => Math.round(parseFloat(v ?? "0") * 100) || 0;
  let liquid = 0, credit = 0, loan = 0, invest = 0, other = 0;
  let investUnknown = false;
  const unavailableAccounts: BalanceSummary["unavailableAccounts"] = [];
  for (const r of rows) {
    if (r.balance === null) {
      unavailableAccounts.push({ id: r.id, name: r.name, type: r.type });
      if (r.type === "investment") investUnknown = true;
      continue;
    }
    const c = cents(r.balance);
    if (r.type === "depository") liquid += c;
    else if (r.type === "credit") credit += c;
    else if (r.type === "loan") loan += c;
    else if (r.type === "investment") invest += c;
    else other += c;
  }
  const staleCutoff = Date.now() - staleAfterDays * 86_400_000;
  const synced = rows
    .map((r) => r.lastSyncedAt?.getTime() ?? 0)
    .filter((t) => t > 0);
  return {
    netWorth: (liquid + invest + other - credit - loan) / 100,
    liquidCash: liquid / 100,
    creditDebt: credit / 100,
    loanDebt: loan / 100,
    investments: investUnknown ? null : invest / 100,
    asOf: synced.length ? new Date(Math.min(...synced)) : null,
    staleAccounts: rows
      .filter((r) => (r.lastSyncedAt?.getTime() ?? 0) < staleCutoff)
      .map((r) => ({ id: r.id, name: r.name, lastSyncedAt: r.lastSyncedAt })),
    unavailableAccounts,
  };
}
