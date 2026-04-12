import { and, eq } from "drizzle-orm";
import { db } from "..";
import { budgets } from "../schema";

export async function getBudgetsByUserId(userId: string) {
  return db.query.budgets.findMany({
    where: eq(budgets.userId, userId),
    with: { category: true },
  });
}

export async function getBudgetByCategory(userId: string, categoryId: string) {
  return db.query.budgets.findFirst({
    where: and(eq(budgets.userId, userId), eq(budgets.categoryId, categoryId)),
    with: { category: true },
  });
}

export async function createBudget(data: typeof budgets.$inferInsert) {
  const [result] = await db.insert(budgets).values(data).returning();
  return result;
}

export async function updateBudget(
  id: string,
  data: Partial<Omit<typeof budgets.$inferInsert, "id">>,
) {
  const [result] = await db
    .update(budgets)
    .set(data)
    .where(eq(budgets.id, id))
    .returning();
  return result;
}

export async function deleteBudget(id: string) {
  const [result] = await db
    .delete(budgets)
    .where(eq(budgets.id, id))
    .returning();
  return result;
}
