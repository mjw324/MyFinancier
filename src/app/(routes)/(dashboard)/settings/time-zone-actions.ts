"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { isValidTimeZone } from "@/lib/utils/time-zone";
import { logError } from "@/lib/logging";

const TimeZoneInput = z.union([
  z.null(),
  z.string().trim().min(1).max(64).refine(isValidTimeZone, "Unknown time zone"),
]);

/**
 * Save a time-zone override (IANA name), or null to follow the browser.
 * getUserTimeZone() prefers the saved value over the `tz` cookie.
 */
export async function updateTimeZoneAction(
  timeZone: string | null,
): Promise<{ success: true; data: { timeZone: string | null } } | { success: false; error: string }> {
  const session = await getServerSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  const userId = session.user.id;

  const parsed = TimeZoneInput.safeParse(timeZone);
  if (!parsed.success) return { success: false, error: "Choose a valid time zone" };

  try {
    await db
      .insert(userPreferences)
      .values({ userId, timeZone: parsed.data })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { timeZone: parsed.data, updatedAt: new Date() },
      });
  } catch (error) {
    logError("preferences.time_zone_failed", error, { userId });
    return { success: false, error: "Could not save the time zone. Please try again." };
  }

  // "Today" moves for every dated view.
  revalidatePath("/", "layout");
  return { success: true, data: { timeZone: parsed.data } };
}
