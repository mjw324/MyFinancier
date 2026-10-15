import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "..";
import { financialAccounts, transactions } from "../schema";
import { PENDING_MAX_AGE_DAYS } from "@/lib/analytics/flow";
import {
  computeAccountBalance,
  fromCents,
  toCents,
  DEFAULT_STALE_AFTER_DAYS,
  type AccountBalanceView,
  type AccountKind,
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

type AccountRow = Awaited<ReturnType<typeof getAccountsByUserId>>[number];

export type AccountWithBalances = AccountRow & {
  balance: AccountBalanceView;
  /** Dollars. 0 when the balance is unavailable — check `balance.state`. */
  settledBalance: number;
  projectedBalance: number;
  /** Signed net-worth contribution in dollars; 0 for closed/unavailable/non-USD accounts. */
  netWorthSettled: number;
  netWorthProjected: number;
  pendingCount: number;
  pendingSum: number;
  pendingTransactions: PendingTxnPreview[];
};

export interface BalanceOptions {
  now?: Date;
  staleAfterDays?: number;
}

const KIND_ORDER: Record<AccountKind, number> = {
  cash: 0,
  credit: 1,
  loan: 2,
  investment: 3,
  other: 4,
};

/**
 * Every account of the user (closed ones included, flagged) with balances
 * computed in integer cents. Pending transactions older than
 * PENDING_MAX_AGE_DAYS are treated as abandoned and ignored.
 */
export async function getAccountsWithBalances(
  userId: string,
  { now = new Date(), staleAfterDays = DEFAULT_STALE_AFTER_DAYS }: BalanceOptions = {},
): Promise<AccountWithBalances[]> {
  const accounts = await getAccountsByUserId(userId);
  if (accounts.length === 0) return [];

  const pendingCutoff = new Date(now.getTime() - PENDING_MAX_AGE_DAYS * 86_400_000);
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
        gte(transactions.date, pendingCutoff),
      ),
    )
    .orderBy(asc(transactions.date));

  const pendingByAccount = new Map<
    string,
    { cents: number; txns: PendingTxnPreview[] }
  >();
  for (const t of pendingTxns) {
    const entry = pendingByAccount.get(t.accountId) ?? { cents: 0, txns: [] };
    entry.cents += toCents(t.amount) ?? 0;
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

  return accounts
    .map((acc) => {
      const p = pendingByAccount.get(acc.id);
      const balance = computeAccountBalance(
        { ...acc, pendingCents: p?.cents ?? 0 },
        { now, staleAfterDays },
      );
      return {
        ...acc,
        balance,
        settledBalance: fromCents(balance.settledCents ?? 0),
        projectedBalance: fromCents(balance.projectedCents ?? 0),
        netWorthSettled: fromCents(balance.netWorthSettledCents),
        netWorthProjected: fromCents(balance.netWorthProjectedCents),
        pendingCount: p?.txns.length ?? 0,
        pendingSum: fromCents(p?.cents ?? 0),
        pendingTransactions: p?.txns ?? [],
      };
    })
    .sort(
      (a, b) =>
        Number(a.balance.state === "closed") - Number(b.balance.state === "closed") ||
        KIND_ORDER[a.balance.kind] - KIND_ORDER[b.balance.kind] ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Balance headline for the dashboard. Contract shared by the dashboard (W3)
 * and the balances work (W4, which owns the implementation).
 *
 * - netWorth: assets − liabilities over open USD accounts with a known balance.
 * - liquidCash: depository balances only (what you can spend).
 * - investments: null when any open investment account has no balance
 *   (Plaid Investments product not enabled) — render "unavailable", never 0.
 * - staleAccounts: open accounts whose balance is older than `staleAfterDays`.
 * - foreignCurrencyAccounts: open non-USD accounts, excluded from every total.
 */
export interface BalanceSummary {
  netWorth: number;
  /** Net worth after recent pending activity. */
  projectedNetWorth: number;
  liquidCash: number;
  creditDebt: number;
  loanDebt: number;
  investments: number | null;
  asOf: Date | null;
  staleAccounts: Array<{ id: string; name: string; lastSyncedAt: Date | null }>;
  unavailableAccounts: Array<{ id: string; name: string; type: string }>;
  foreignCurrencyAccounts: Array<{ id: string; name: string; currency: string }>;
}

export function summarizeBalances(views: AccountBalanceView[]): BalanceSummary {
  let netWorth = 0;
  let projectedNetWorth = 0;
  const byKind: Record<AccountKind, number> = {
    cash: 0,
    credit: 0,
    loan: 0,
    investment: 0,
    other: 0,
  };
  let investmentUnknown = false;
  const staleAccounts: BalanceSummary["staleAccounts"] = [];
  const unavailableAccounts: BalanceSummary["unavailableAccounts"] = [];
  const foreignCurrencyAccounts: BalanceSummary["foreignCurrencyAccounts"] = [];
  let asOf: Date | null = null;

  for (const v of views) {
    if (v.state === "closed") continue;
    if (v.state === "unavailable") {
      unavailableAccounts.push({ id: v.id, name: v.name, type: v.type });
      if (v.kind === "investment") investmentUnknown = true;
      continue;
    }
    if (v.state === "foreign_currency") {
      foreignCurrencyAccounts.push({ id: v.id, name: v.name, currency: v.currency });
      continue;
    }
    netWorth += v.netWorthSettledCents;
    projectedNetWorth += v.netWorthProjectedCents;
    byKind[v.kind] += v.settledCents ?? 0;
    if (v.isStale) {
      staleAccounts.push({ id: v.id, name: v.name, lastSyncedAt: v.balanceAsOf });
    }
    if (v.balanceAsOf && (!asOf || v.balanceAsOf < asOf)) asOf = v.balanceAsOf;
  }

  return {
    netWorth: fromCents(netWorth),
    projectedNetWorth: fromCents(projectedNetWorth),
    liquidCash: fromCents(byKind.cash),
    creditDebt: fromCents(byKind.credit),
    loanDebt: fromCents(byKind.loan),
    investments: investmentUnknown ? null : fromCents(byKind.investment),
    asOf,
    staleAccounts,
    unavailableAccounts,
    foreignCurrencyAccounts,
  };
}

export async function getBalanceSummary(
  userId: string,
  opts: BalanceOptions = {},
): Promise<BalanceSummary> {
  const accounts = await getAccountsWithBalances(userId, opts);
  return summarizeBalances(accounts.map((a) => a.balance));
}
