import { eq } from "drizzle-orm";
import { db } from "..";
import { financialAccounts } from "../schema";

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
