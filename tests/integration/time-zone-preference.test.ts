import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { makeUser } from "../setup/factories";

const ctx = vi.hoisted(() => ({ userId: "user_a", tz: "Europe/Berlin" }));
vi.mock("@/lib/auth/get-session", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: ctx.userId } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "tz" ? { name, value: ctx.tz } : undefined),
  }),
  headers: async () => new Headers(),
}));

import { updateTimeZoneAction } from "@/app/(routes)/(dashboard)/settings/time-zone-actions";
import { getUserTimeZone } from "@/lib/utils/user-time";

beforeEach(async () => {
  await getTestDb().insert(user).values(makeUser({ id: "user_a" }));
});

const saved = async () =>
  (await getTestDb().select().from(userPreferences).where(eq(userPreferences.userId, "user_a")))[0]
    ?.timeZone ?? null;

describe("time-zone preference", () => {
  it("falls back to the browser cookie when nothing is saved", async () => {
    expect(await getUserTimeZone()).toBe("Europe/Berlin");
  });

  it("saves a valid IANA zone, which then wins over the cookie", async () => {
    expect(await updateTimeZoneAction("America/Denver")).toEqual({
      success: true,
      data: { timeZone: "America/Denver" },
    });
    expect(await saved()).toBe("America/Denver");
    expect(await getUserTimeZone()).toBe("America/Denver");
  });

  it("rejects unknown zones without throwing and clears with null", async () => {
    expect(await updateTimeZoneAction("Mars/Olympus")).toMatchObject({ success: false });
    expect(await updateTimeZoneAction("x".repeat(100))).toMatchObject({ success: false });
    await updateTimeZoneAction("Asia/Tokyo");
    expect(await updateTimeZoneAction(null)).toMatchObject({ success: true });
    expect(await saved()).toBeNull();
    expect(await getUserTimeZone()).toBe("Europe/Berlin");
  });
});
