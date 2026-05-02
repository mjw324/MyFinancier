import { and, count, eq, sql } from "drizzle-orm";
import { db } from "..";
import { spendingRules } from "../schema/spending-rules";
import { transactions } from "../schema/transactions";

export interface SpendingRuleWithCount {
  id: string;
  matchType: "merchant" | "name_signature";
  matchValue: string;
  spendingType: "necessary" | "discretionary";
  affectedCount: number;
}

export async function listSpendingRules(
  userId: string,
): Promise<SpendingRuleWithCount[]> {
  const rules = await db
    .select()
    .from(spendingRules)
    .where(eq(spendingRules.userId, userId))
    .orderBy(spendingRules.matchValue);

  if (rules.length === 0) return [];

  const out: SpendingRuleWithCount[] = [];
  for (const rule of rules) {
    const matchColumn =
      rule.matchType === "merchant"
        ? transactions.normalizedMerchant
        : transactions.nameSignature;
    const [{ c }] = await db
      .select({ c: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(matchColumn, rule.matchValue),
          sql`${transactions.spendingTypeSource} = 'rule'`,
        ),
      );
    out.push({
      id: rule.id,
      matchType: rule.matchType as "merchant" | "name_signature",
      matchValue: rule.matchValue,
      spendingType: rule.spendingType as "necessary" | "discretionary",
      affectedCount: c,
    });
  }
  return out;
}
