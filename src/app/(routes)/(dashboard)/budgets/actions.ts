"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import { budgets, BUDGET_PERIODS } from "@/lib/db/schema";
import { isAllowedBudgetKey } from "@/lib/db/queries/categories";
import { findOverlappingBudget, getBudgetForUser } from "@/lib/db/queries/budgets";
import { logError } from "@/lib/logging";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const MAX_BUDGET = 10_000_000;

/** A real calendar date "YYYY-MM-DD" (rejects 2026-02-31). */
const calendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    const year = d.getUTCFullYear();
    return (
      !Number.isNaN(d.getTime()) &&
      d.toISOString().startsWith(s) &&
      year >= 1990 &&
      year <= 2100
    );
  }, "Use a valid date");

const budgetFields = z
  .object({
    categoryKey: z.string().trim().min(1, "Choose a category").max(100),
    amount: z.coerce
      .number({ error: "Enter an amount" })
      .finite("Enter an amount")
      .positive("Amount must be more than zero")
      .max(MAX_BUDGET, "Amount is too large")
      .transform((n) => Math.round(n * 100) / 100)
      .refine((n) => n >= 0.01, "Amount must be at least $0.01"),
    period: z.enum(BUDGET_PERIODS, { error: "Choose a period" }),
    startDate: calendarDate,
    endDate: z
      .union([calendarDate, z.literal(""), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

const budgetId = z.string().trim().min(1).max(64);

export type BudgetInput = z.input<typeof budgetFields>;

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

async function validate(userId: string, input: unknown, excludeId?: string) {
  const parsed = budgetFields.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid budget" };
  }
  const v = parsed.data;
  // The key must be a built-in bucket or one of THIS user's own categories.
  if (!(await isAllowedBudgetKey(userId, v.categoryKey))) {
    return { ok: false as const, error: "Choose one of your categories" };
  }
  const values = {
    categoryKey: v.categoryKey,
    amount: v.amount.toFixed(2),
    period: v.period,
    startDate: toDate(v.startDate),
    endDate: v.endDate ? toDate(v.endDate) : null,
  };
  if (await findOverlappingBudget(userId, values, excludeId)) {
    return {
      ok: false as const,
      error: `You already have a ${v.period} budget for this category in those dates`,
    };
  }
  return { ok: true as const, values };
}

export async function createBudgetAction(
  input: BudgetInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  try {
    const v = await validate(userId, input);
    if (!v.ok) return { success: false, error: v.error };
    const [row] = await db
      .insert(budgets)
      .values({ userId, ...v.values })
      .returning({ id: budgets.id });
    revalidatePath("/budgets");
    revalidatePath("/dashboard");
    return { success: true, data: { id: row.id } };
  } catch (error) {
    logError("budget.create_failed", error, { userId });
    return { success: false, error: "Could not save the budget. Please try again." };
  }
}

export async function updateBudgetAction(
  input: BudgetInput & { budgetId: string },
): Promise<ActionResult<{ id: string }>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  const id = budgetId.safeParse(input?.budgetId);
  if (!id.success) return { success: false, error: "Budget not found" };

  try {
    if (!(await getBudgetForUser(userId, id.data))) {
      return { success: false, error: "Budget not found" };
    }
    const v = await validate(userId, input, id.data);
    if (!v.ok) return { success: false, error: v.error };
    await db
      .update(budgets)
      .set(v.values)
      .where(and(eq(budgets.id, id.data), eq(budgets.userId, userId)));
    revalidatePath("/budgets");
    revalidatePath("/dashboard");
    return { success: true, data: { id: id.data } };
  } catch (error) {
    logError("budget.update_failed", error, { userId });
    return { success: false, error: "Could not save the budget. Please try again." };
  }
}

export async function deleteBudgetAction(
  rawBudgetId: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  const id = budgetId.safeParse(rawBudgetId);
  if (!id.success) return { success: false, error: "Budget not found" };

  try {
    const deleted = await db
      .delete(budgets)
      .where(and(eq(budgets.id, id.data), eq(budgets.userId, userId)))
      .returning({ id: budgets.id });
    if (deleted.length === 0) return { success: false, error: "Budget not found" };
    revalidatePath("/budgets");
    revalidatePath("/dashboard");
    return { success: true, data: { id: id.data } };
  } catch (error) {
    logError("budget.delete_failed", error, { userId });
    return { success: false, error: "Could not delete the budget. Please try again." };
  }
}
