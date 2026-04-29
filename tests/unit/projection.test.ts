import { describe, it, expect } from "vitest";
import {
  projectStreamEvents,
  type ProjectionInputStream,
} from "@/lib/plaid/projection";

function baseStream(
  overrides: Partial<ProjectionInputStream> = {},
): ProjectionInputStream {
  return {
    streamId: "s1",
    flowType: "outflow",
    frequency: "MONTHLY",
    status: "MATURE",
    isActive: true,
    predictedNextDate: new Date(2026, 4, 5), // May 5 2026
    lastDate: new Date(2026, 3, 5),
    averageAmount: 100,
    lastAmount: 100,
    merchantName: "Acme",
    description: "Acme Subscription",
    ...overrides,
  };
}

describe("projectStreamEvents", () => {
  it("WEEKLY: emits an event every 7 days", () => {
    const events = projectStreamEvents(
      baseStream({
        frequency: "WEEKLY",
        predictedNextDate: new Date(2026, 4, 1),
      }),
      new Date(2026, 4, 1),
      new Date(2026, 4, 28),
    );
    expect(events.map((e) => e.date.getDate())).toEqual([1, 8, 15, 22]);
  });

  it("BIWEEKLY: every 14 days", () => {
    const events = projectStreamEvents(
      baseStream({
        frequency: "BIWEEKLY",
        predictedNextDate: new Date(2026, 4, 1),
      }),
      new Date(2026, 4, 1),
      new Date(2026, 5, 30),
    );
    expect(events.map((e) => e.date.toISOString().slice(0, 10))).toEqual([
      "2026-05-01",
      "2026-05-15",
      "2026-05-29",
      "2026-06-12",
      "2026-06-26",
    ]);
  });

  it("MONTHLY: preserves day-of-month and clamps end of month", () => {
    const events = projectStreamEvents(
      baseStream({ predictedNextDate: new Date(2026, 0, 31) }), // Jan 31
      new Date(2026, 0, 1),
      new Date(2026, 3, 30),
    );
    const isos = events.map((e) =>
      `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, "0")}-${String(e.date.getDate()).padStart(2, "0")}`,
    );
    expect(isos).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("ANNUALLY: handles leap-year Feb 29", () => {
    const events = projectStreamEvents(
      baseStream({
        frequency: "ANNUALLY",
        predictedNextDate: new Date(2024, 1, 29), // Feb 29 2024
      }),
      new Date(2024, 0, 1),
      new Date(2027, 11, 31),
    );
    const isos = events.map((e) =>
      `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, "0")}-${String(e.date.getDate()).padStart(2, "0")}`,
    );
    expect(isos).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
    ]);
  });

  it("SEMI_MONTHLY: derives both days from recent transaction dates", () => {
    const events = projectStreamEvents(
      baseStream({
        frequency: "SEMI_MONTHLY",
        predictedNextDate: new Date(2026, 4, 5),
        recentTransactionDates: [
          new Date(2026, 3, 20),
          new Date(2026, 3, 5),
        ],
      }),
      new Date(2026, 4, 1),
      new Date(2026, 5, 30),
    );
    const days = events.map((e) => e.date.getDate());
    expect(days).toEqual([5, 20, 5, 20]);
  });

  it("SEMI_MONTHLY: falls back to 15th + last day when no history", () => {
    const events = projectStreamEvents(
      baseStream({
        frequency: "SEMI_MONTHLY",
        predictedNextDate: new Date(2026, 4, 1),
      }),
      new Date(2026, 4, 1),
      new Date(2026, 4, 31),
    );
    const days = events.map((e) => e.date.getDate());
    expect(days).toEqual([15, 31]);
  });

  it("UNKNOWN: emits only the predicted_next_date if in window", () => {
    const events = projectStreamEvents(
      baseStream({
        frequency: "UNKNOWN",
        predictedNextDate: new Date(2026, 4, 10),
      }),
      new Date(2026, 4, 1),
      new Date(2026, 4, 31),
    );
    expect(events).toHaveLength(1);
    expect(events[0].date.getDate()).toBe(10);
  });

  it("excludes TOMBSTONED and inactive streams", () => {
    expect(
      projectStreamEvents(
        baseStream({ status: "TOMBSTONED" }),
        new Date(2026, 0, 1),
        new Date(2027, 0, 1),
      ),
    ).toEqual([]);
    expect(
      projectStreamEvents(
        baseStream({ isActive: false }),
        new Date(2026, 0, 1),
        new Date(2027, 0, 1),
      ),
    ).toEqual([]);
  });

  it("flags has_price_change when last_amount differs > 5%", () => {
    const events = projectStreamEvents(
      baseStream({ averageAmount: 100, lastAmount: 110 }),
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );
    expect(events[0].hasPriceChange).toBe(true);
  });

  it("does not flag price change within 5%", () => {
    const events = projectStreamEvents(
      baseStream({ averageAmount: 100, lastAmount: 103 }),
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );
    expect(events[0].hasPriceChange).toBe(false);
  });

  it("marks EARLY_DETECTION as tentative", () => {
    const events = projectStreamEvents(
      baseStream({ status: "EARLY_DETECTION" }),
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );
    expect(events[0].tentative).toBe(true);
  });
});
