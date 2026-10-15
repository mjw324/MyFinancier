import { describe, expect, it } from "vitest";
import { calendarDateInTimeZone, isValidTimeZone } from "@/lib/utils/time-zone";

describe("calendarDateInTimeZone", () => {
  it("keeps New York on the previous day after 8pm EDT", () => {
    const now = new Date("2026-09-01T00:30:00Z"); // Aug 31, 8:30pm EDT
    expect(calendarDateInTimeZone(now, "America/New_York").toISOString()).toBe(
      "2026-08-31T00:00:00.000Z",
    );
    expect(calendarDateInTimeZone(now, "UTC").toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("moves east-of-UTC zones forward", () => {
    const now = new Date("2026-08-31T20:00:00Z");
    expect(calendarDateInTimeZone(now, "Asia/Tokyo").toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("handles DST transition days", () => {
    // 2026-11-01 is the US fall-back day.
    const now = new Date("2026-11-01T05:30:00Z"); // 12:30am EST / 1:30am EDT
    expect(calendarDateInTimeZone(now, "America/New_York").toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});
