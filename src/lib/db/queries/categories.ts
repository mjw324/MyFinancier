import { eq, or, isNull } from "drizzle-orm";
import { db } from "..";
import { categories } from "../schema";

export async function getCategoriesByUserId(userId: string) {
  return db.query.categories.findMany({
    where: or(eq(categories.userId, userId), isNull(categories.userId)),
  });
}
