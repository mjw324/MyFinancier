/**
 * Seed-profile data for the chat evals: a profile's custom Items become
 * accounts and transactions in PGlite, categorized with the hand labels
 * (category-labels.ts) and classified by the real post-processing, so tools
 * read exactly what the dashboard would.
 */

import { sql } from "drizzle-orm";
import { getTestDb } from "./pglite";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "./factories";
import { labelFor } from "./category-labels";
import { buildProfiles, type Profile } from "../../scripts/seed-profiles";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { postProcessTransactions } from "@/lib/plaid/post-process";

export const CUSTOM_PROFILES = buildProfiles().filter((p) => p.items.some((i) => i.kind === "custom"));

export async function seedUser(userId: string, opts: { optIn?: boolean; timeZone?: string } = {}) {
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: userId, email: `${userId}@test.local` }));
  await db.insert(userPreferences).values({
    userId,
    timeZone: opts.timeZone ?? "UTC",
    ...(opts.optIn === false ? {} : { aiOptIn: true, aiConsentAt: new Date(), aiConsentVersion: "v1" }),
  });
}

/** Insert a profile's custom Items for `userId` and classify the rows. Returns the account ids. */
export async function seedProfile(userId: string, profile: Profile): Promise<string[]> {
  const db = getTestDb();
  const accountIds: string[] = [];
  const txnIds: string[] = [];
  let n = 0;
  for (const [i, item] of profile.items.entries()) {
    if (item.kind !== "custom") continue;
    const itemId = `${userId}_pi${i}`;
    await db.insert(plaidItems).values(makePlaidItem({ id: itemId, userId, itemId: `${itemId}_plaid` }));
    for (const [j, a] of item.accounts.entries()) {
      const accountId = `${itemId}_a${j}`;
      accountIds.push(accountId);
      await db.insert(financialAccounts).values(
        makeAccount({
          id: accountId,
          userId,
          plaidItemId: itemId,
          plaidAccountId: `${accountId}_plaid`,
          name: a.meta.name,
          mask: a.meta.mask,
          type: a.type,
          subtype: a.subtype,
          currentBalance: String(a.starting_balance),
          lastSyncedAt: new Date(),
        }),
      );
      const rows = a.transactions.map((t) => {
        const id = `${userId}_t${n++}`;
        txnIds.push(id);
        return makeTxn({
          id,
          userId,
          accountId,
          plaidTransactionId: `${id}_plaid`,
          name: t.description,
          merchantName: null,
          amount: String(t.amount),
          date: new Date(`${t.date_posted}T00:00:00Z`),
          category: labelFor(t.description, t.amount),
          pending: false,
        });
      });
      for (let k = 0; k < rows.length; k += 250) await db.insert(transactions).values(rows.slice(k, k + 250));
    }
  }
  await postProcessTransactions(userId, txnIds);
  return accountIds;
}

const SPEND_CLASSES = sql.raw(
  `('spending','debt_payment','cash_withdrawal','p2p_payment','refund','reimbursement','card_reward')`,
);

/**
 * Independent SQL for the evals' expected figures: written here by hand
 * against the table, not through lib/analytics, so a regression in the
 * metrics layer shows up as a mismatch.
 */
export async function sqlNetSpendingByBucket(userId: string, from: string, toExclusive: string): Promise<Map<string, number>> {
  const res = await getTestDb().execute(sql`
    SELECT CASE
             WHEN custom_category IS NOT NULL THEN custom_category
             WHEN flow_class = 'cash_withdrawal' THEN 'CASH_WITHDRAWALS'
             WHEN flow_class = 'p2p_payment' THEN 'SENT_TO_PEOPLE'
             WHEN flow_class = 'reimbursement' THEN 'REIMBURSEMENTS'
             WHEN flow_class = 'card_reward' THEN 'REWARDS'
             ELSE COALESCE(category, 'UNCATEGORIZED')
           END AS bucket,
           ROUND(SUM(amount::numeric) * 100)::bigint AS cents
    FROM transactions
    WHERE user_id = ${userId} AND date >= ${from}::timestamp AND date < ${toExclusive}::timestamp
      AND flow_class IN ${SPEND_CLASSES} AND pending IS NOT TRUE
    GROUP BY 1`);
  return new Map((res.rows as Array<{ bucket: string; cents: string | number }>).map((r) => [r.bucket, Number(r.cents)]));
}

export async function sqlMoneyInCents(userId: string, from: string, toExclusive: string): Promise<number> {
  const res = await getTestDb().execute(sql`
    SELECT COALESCE(ROUND(SUM(-amount::numeric) * 100), 0)::bigint AS cents
    FROM transactions
    WHERE user_id = ${userId} AND date >= ${from}::timestamp AND date < ${toExclusive}::timestamp
      AND flow_class IN ('income', 'other_inflow') AND pending IS NOT TRUE`);
  return Number((res.rows[0] as { cents: string | number }).cents);
}

export async function sqlCountMatching(userId: string, text: string, from: string, toExclusive: string): Promise<number> {
  const res = await getTestDb().execute(sql`
    SELECT COUNT(*)::int AS n FROM transactions
    WHERE user_id = ${userId} AND date >= ${from}::timestamp AND date < ${toExclusive}::timestamp
      AND (name ILIKE ${`%${text}%`} OR merchant_name ILIKE ${`%${text}%`} OR custom_name ILIKE ${`%${text}%`})`);
  return Number((res.rows[0] as { n: number }).n);
}
