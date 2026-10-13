import { cookies } from "next/headers";
import {
  TIME_ZONE_COOKIE,
  calendarDateInTimeZone,
  isValidTimeZone,
} from "./time-zone";

/** The viewer's IANA time zone (from the `tz` cookie), falling back to UTC. */
export async function getUserTimeZone(): Promise<string> {
  const store = await cookies();
  const value = store.get(TIME_ZONE_COOKIE)?.value;
  const decoded = value ? decodeURIComponent(value) : undefined;
  return isValidTimeZone(decoded) ? decoded : "UTC";
}

/** The viewer's calendar date, as a UTC-midnight Date. */
export async function getUserToday(now: Date = new Date()): Promise<Date> {
  return calendarDateInTimeZone(now, await getUserTimeZone());
}
