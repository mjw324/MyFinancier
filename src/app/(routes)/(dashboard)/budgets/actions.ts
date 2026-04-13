"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import { budgets } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const createBudgetSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  amount: z.string().refine((v) => parseFloat(v) > 0, "Amount must be positive"),
  period: z.enum(["monthly", "weekly", "yearly"]),
  startDate: z.string().min(1, "Start date is required"),
});

const updateBudgetSchema = createBudgetSchema.extend({
  budgetId: z.string().min(1),
});

export async function createBudgetAction(formData: {
  categoryId: string;
  amount: string;
  period: string;
  startDate: string;
}) {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };

  const parsed = createBudgetSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  await db.insert(budgets).values({
    userId: session.user.id,
    categoryId: parsed.data.categoryId,
    amount: parsed.data.amount,
    period: parsed.data.period,
    startDate: new Date(parsed.data.startDate),
  });

  revalidatePath("/budgets");
  return { success: true as const };
}

export async function updateBudgetAction(formData: {
  budgetId: string;
  categoryId: string;
  amount: string;
  period: string;
  startDate: string;
}) {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };

  const parsed = updateBudgetSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  const [existing] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(eq(budgets.id, parsed.data.budgetId), eq(budgets.userId, session.user.id)),
    );

  if (!existing) {
    return { success: false as const, error: "Budget not found" };
  }

  await db
    .update(budgets)
    .set({
      categoryId: parsed.data.categoryId,
      amount: parsed.data.amount,
      period: parsed.data.period,
      startDate: new Date(parsed.data.startDate),
    })
    .where(eq(budgets.id, parsed.data.budgetId));

  revalidatePath("/budgets");
  return { success: true as const };
}

export async function deleteBudgetAction(budgetId: string) {
  const session = await getServerSession();
  if (!session?.user) return { success: false as const, error: "Unauthorized" };

  const [existing] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(eq(budgets.id, budgetId), eq(budgets.userId, session.user.id)),
    );

  if (!existing) {
    return { success: false as const, error: "Budget not found" };
  }

  await db.delete(budgets).where(eq(budgets.id, budgetId));

  revalidatePath("/budgets");
  return { success: true as const };
}
