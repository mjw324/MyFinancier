import { describe, it, expect } from "vitest";
import {
  assessStream,
  hasPriceChange,
  isBillStream,
  isCardPaymentStream,
  isIncomeStream,
  projectStreamEvents,
  type ProjectionInputStream,
} from "@/lib/plaid/projection";

// Stream dates are calendar dates stored at UTC midnight.
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

function baseStream(
  overrides: Partial<ProjectionInputStream> = {},
): ProjectionInputStream {
  return {
    streamId: "s1",
    flowType: "outflow",
    frequency: "MONTHLY",
    status: "MATURE",
    isActive: true,
    predictedNextDate: d("2026-05-05"),
    lastDate: d("2026-04-05"),
    averageAmount: 100,
    lastAmount: 100,
    merchantName: "Acme",
    description: "Acme Subscription",
    customName: null,
    ...overrides,
  };
}

describe("projectStreamEvents", () => {
  it("WEEKLY: emits an event every 7 days", () => {
    const events = projectStreamEvents(
      baseStream({ frequency: "WEEKLY", predictedNextDate: d("2026-05-01"), lastDate: d("2026-04-24") }),
      d("2026-05-01"),
      d("2026-05-28"),
    );
    expect(events.map((e) => iso(e.date))).toEqual([
      "2026-05-01",
      "2026-05-08",
      "2026-05-15",
      "2026-05-22",
    ]);
  });

  it("BIWEEKLY: every 14 days", () => {
    const events = projectStreamEvents(
      baseStream({ frequency: "BIWEEKLY", predictedNextDate: d("2026-05-01"), lastDate: d("2026-04-17") }),
      d("2026-05-01"),
      d("2026-06-30"),
    );
    expect(events.map((e) => iso(e.date))).toEqual([
      "2026-05-01",
      "2026-05-15",
      "2026-05-29",
      "2026-06-12",
      "2026-06-26",
    ]);
  });

  it("MONTHLY: preserves day-of-month and clamps end of month", () => {
    const events = projectStreamEvents(
      baseStream({ predictedNextDate: d("2026-01-31"), lastDate: d("2025-12-31") }),
      d("2026-01-01"),
      d("2026-04-30"),
    );
    expect(events.map((e) => iso(e.date))).toEqual([
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
        predictedNextDate: d("2024-02-29"),
        lastDate: d("2023-02-28"),
      }),
      d("2024-01-01"),
      d("2027-12-31"),
    );
    expect(events.map((e) => iso(e.date))).toEqual([
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
        predictedNextDate: d("2026-05-05"),
        lastDate: d("2026-04-20"),
        recentTransactionDates: [d("2026-04-20"), d("2026-04-05")],
      }),
      d("2026-05-01"),
      d("2026-06-30"),
    );
    expect(events.map((e) => iso(e.date))).toEqual([
      "2026-05-05",
      "2026-05-20",
      "2026-06-05",
      "2026-06-20",
    ]);
  });

  it("SEMI_MONTHLY: falls back to 15th + last day when no history", () => {
    const events = projectStreamEvents(
      baseStream({ frequency: "SEMI_MONTHLY", predictedNextDate: d("2026-05-01"), lastDate: d("2026-04-30") }),
      d("2026-05-01"),
      d("2026-05-31"),
    );
    expect(events.map((e) => iso(e.date))).toEqual(["2026-05-15", "2026-05-31"]);
  });

  it("UNKNOWN: emits only the predicted_next_date if in window", () => {
    const events = projectStreamEvents(
      baseStream({ frequency: "UNKNOWN", predictedNextDate: d("2026-05-10") }),
      d("2026-05-01"),
      d("2026-05-31"),
    );
    expect(events.map((e) => iso(e.date))).toEqual(["2026-05-10"]);
  });

  it("excludes TOMBSTONED and inactive streams", () => {
    expect(
      projectStreamEvents(baseStream({ status: "TOMBSTONED" }), d("2026-01-01"), d("2027-01-01")),
    ).toEqual([]);
    expect(
      projectStreamEvents(baseStream({ isActive: false }), d("2026-01-01"), d("2027-01-01")),
    ).toEqual([]);
  });

  it("flags has_price_change when last_amount differs > 5%", () => {
    const events = projectStreamEvents(
      baseStream({ averageAmount: 100, lastAmount: 110 }),
      d("2026-01-01"),
      d("2026-12-31"),
    );
    expect(events[0].hasPriceChange).toBe(true);
  });

  it("does not flag price change within 5%", () => {
    const events = projectStreamEvents(
      baseStream({ averageAmount: 100, lastAmount: 103 }),
      d("2026-01-01"),
      d("2026-12-31"),
    );
    expect(events[0].hasPriceChange).toBe(false);
  });

  it("marks EARLY_DETECTION as tentative", () => {
    const events = projectStreamEvents(
      baseStream({ status: "EARLY_DETECTION" }),
      d("2026-01-01"),
      d("2026-12-31"),
    );
    expect(events[0].tentative).toBe(true);
  });

  it("does not shift days when the process runs west of UTC", () => {
    // Regression for local getters: a UTC-midnight date is the previous local
    // day in America/*, which used to move every bill back by one day.
    const events = projectStreamEvents(
      baseStream({ predictedNextDate: d("2026-08-01"), lastDate: d("2026-07-01") }),
      d("2026-08-01"),
      d("2026-08-31"),
    );
    expect(events.map((e) => iso(e.date))).toEqual(["2026-08-01"]);
  });
});

describe("verify-calcs 7.1 — stale predicted_next_date", () => {
  it("a utility last paid in June does not project bills in September", () => {
    const ev = projectStreamEvents(
      baseStream({
        predictedNextDate: d("2026-07-23"),
        lastDate: d("2026-06-23"),
        lastAmount: 115.09,
        averageAmount: 115.09,
      }),
      d("2026-09-01"),
      d("2026-09-30"),
    );
    expect(ev).toHaveLength(0);
  });

  it("a card payment stream 36 days overdue (last seen 67 days ago) is stale", () => {
    const stream = baseStream({
      description: "CARD ONLINE PAYMENT",
      pfcPrimary: "LOAN_PAYMENTS",
      predictedNextDate: d("2026-09-07"),
      lastDate: d("2026-08-07"),
    });
    const a = assessStream(stream, d("2026-10-13"));
    expect(a.health).toBe("stale");
    expect(projectStreamEvents(stream, d("2026-10-13"), d("2026-11-30"))).toEqual([]);
  });

  it("a bill one day late is still expected and is counted on today", () => {
    const stream = baseStream({
      frequency: "BIWEEKLY",
      predictedNextDate: d("2026-10-12"),
      lastDate: d("2026-09-28"),
    });
    expect(assessStream(stream, d("2026-10-13")).health).toBe("late");
    const ev = projectStreamEvents(stream, d("2026-10-13"), d("2026-10-31"));
    expect(ev.map((e) => [iso(e.date), iso(e.dueDate), e.late])).toEqual([
      ["2026-10-13", "2026-10-12", true],
      ["2026-10-26", "2026-10-26", false],
    ]);
  });

  it("staleness is measured against today, not the window start", () => {
    // Bill calendar looking at next month: the stream is stale today.
    const stream = baseStream({ predictedNextDate: d("2026-08-20"), lastDate: d("2026-07-20") });
    expect(
      projectStreamEvents(stream, d("2026-11-01"), d("2026-11-30"), { today: d("2026-10-13") }),
    ).toEqual([]);
  });
});

describe("verify-calcs 7.6 — posted/pending occurrence is not projected again", () => {
  it("skips an occurrence settled within ±3 days and keeps the next one", () => {
    const stream = baseStream({ predictedNextDate: d("2026-10-12"), lastDate: d("2026-09-12") });
    const ev = projectStreamEvents(stream, d("2026-10-13"), d("2026-11-30"), {
      today: d("2026-10-13"),
      settledDates: [d("2026-10-11")],
    });
    expect(ev.map((e) => iso(e.date))).toEqual(["2026-11-12"]);
    expect(assessStream(stream, d("2026-10-13"), [d("2026-10-11")]).health).toBe("ok");
  });

  it("a bill paid two days early is not counted on its due date", () => {
    const stream = baseStream({ predictedNextDate: d("2026-10-15"), lastDate: d("2026-09-15") });
    const ev = projectStreamEvents(stream, d("2026-10-13"), d("2026-10-31"), {
      today: d("2026-10-13"),
      settledDates: [d("2026-10-13")],
    });
    expect(ev).toEqual([]);
  });
});

describe("verify-calcs 7.4 — inflow price change", () => {
  it("a 25% pay change on an inflow stream is flagged", () => {
    const ev = projectStreamEvents(
      baseStream({
        flowType: "inflow",
        frequency: "BIWEEKLY",
        predictedNextDate: d("2026-09-04"),
        lastDate: d("2026-08-21"),
        averageAmount: -2000,
        lastAmount: -2500,
      }),
      d("2026-09-01"),
      d("2026-09-10"),
    );
    expect(ev[0].hasPriceChange).toBe(true);
    expect(hasPriceChange(-2000, -2050)).toBe(false);
  });
});

describe("stream classification", () => {
  const s = (o: Partial<ProjectionInputStream>) => baseStream(o);
  it("separates bills, card payments, transfers and income", () => {
    expect(isBillStream(s({ pfcPrimary: "RENT_AND_UTILITIES" }))).toBe(true);
    expect(isBillStream(s({ pfcPrimary: "TRANSFER_OUT" }))).toBe(false);
    expect(
      isBillStream(s({ pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })),
    ).toBe(false);
    expect(isCardPaymentStream(s({ pfcPrimary: "LOAN_PAYMENTS", description: "BANK CARD ONLINE PAYMENT" }))).toBe(true);
    // A student-loan payment is a bill, not a card payment.
    expect(isBillStream(s({ pfcPrimary: "LOAN_PAYMENTS", description: "STUDENT LOAN SERVICER" }))).toBe(true);
    expect(isIncomeStream(s({ flowType: "inflow", pfcPrimary: "INCOME" }))).toBe(true);
    expect(isIncomeStream(s({ flowType: "inflow", pfcPrimary: "TRANSFER_IN" }))).toBe(false);
  });
});
