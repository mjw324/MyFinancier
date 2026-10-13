import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import {
  TIME_ZONE_COOKIE,
  calendarDateInTimeZone,
  isValidTimeZone,
} from "./time-zone";

/**
 * The time zone the signed-in user saved in Settings, if any. Memoised per
 * request; never throws (a failure falls back to the cookie). Auth and the db
 * are imported lazily so importing this module stays side-effect free.
 */
export const getSavedTimeZone = cache(async (): Promise<string | null> => {
  try {
    const [{ getServerSession }, { db }, { userPreferences }] = await Promise.all([
      import("@/lib/auth/get-session"),
      import("@/lib/db"),
      import("@/lib/db/schema/user-preferences"),
    ]);
    const session = await getServerSession();
    const userId = session?.user?.id;
    if (!userId) return null;
    const [row] = await db
      .select({ timeZone: userPreferences.timeZone })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return isValidTimeZone(row?.timeZone) ? row.timeZone : null;
  } catch {
    return null;
  }
});

/** The browser's time zone, from the `tz` cookie kept by <TimeZoneSync/>. */
export async function getDetectedTimeZone(): Promise<string | null> {
  try {
    const store = await cookies();
    const value = store.get(TIME_ZONE_COOKIE)?.value;
    const decoded = value ? decodeURIComponent(value) : undefined;
    return isValidTimeZone(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * The viewer's IANA time zone: the saved preference, else the browser's
 * (`tz` cookie), else UTC.
 */
export async function getUserTimeZone(): Promise<string> {
  return (await getSavedTimeZone()) ?? (await getDetectedTimeZone()) ?? "UTC";
}

/** The viewer's calendar date, as a UTC-midnight Date. */
export async function getUserToday(now: Date = new Date()): Promise<Date> {
  return calendarDateInTimeZone(now, await getUserTimeZone());
}
