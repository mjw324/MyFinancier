import { eq } from "drizzle-orm";
import { db } from "..";
import { plaidItems } from "../schema";

export async function getPlaidItemsByUserId(userId: string) {
  return db.query.plaidItems.findMany({
    where: eq(plaidItems.userId, userId),
    with: { financialAccounts: true },
  });
}

export async function getPlaidItemById(id: string) {
  return db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, id),
    with: { financialAccounts: true },
  });
}
