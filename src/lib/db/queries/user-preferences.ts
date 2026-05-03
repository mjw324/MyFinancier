import { eq } from "drizzle-orm";
import { db } from "..";
import { userPreferences } from "../schema";

export interface UserPreferencesShape {
  hideTransfersFromList: boolean;
}

const DEFAULTS: UserPreferencesShape = {
  hideTransfersFromList: false,
};

export async function getUserPreferences(
  userId: string,
): Promise<UserPreferencesShape> {
  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (!row) return DEFAULTS;
  return {
    hideTransfersFromList: row.hideTransfersFromList,
  };
}

export async function upsertUserPreferences(
  userId: string,
  patch: Partial<UserPreferencesShape>,
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({
      userId,
      hideTransfersFromList: patch.hideTransfersFromList ?? false,
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        ...(patch.hideTransfersFromList !== undefined
          ? { hideTransfersFromList: patch.hideTransfersFromList }
          : {}),
        updatedAt: new Date(),
      },
    });
}
