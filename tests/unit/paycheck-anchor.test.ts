import { describe, expect, it } from "vitest";
import { paycheckStreamIds, type ForecastStream } from "@/lib/forecast/safe-to-spend";

function stream(id: string, over: Partial<ForecastStream>): ForecastStream {
  return {
    streamId: id,
    accountId: "acct",
    isActive: true,
    status: "MATURE",
    flowType: "inflow",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_WAGES",
    averageAmount: -2000,
    lastAmount: -2000,
    description: id,
    merchantName: null,
    customName: null,
    ...over,
  } as ForecastStream;
}

describe("paycheckStreamIds", () => {
  it("excludes interest and dividends, which are not paychecks", () => {
    const ids = paycheckStreamIds([
      stream("payroll", {}),
      stream("interest", { pfcDetailed: "INCOME_INTEREST_EARNED", lastAmount: -0.12, averageAmount: -0.12 }),
      stream("dividends", { pfcDetailed: "INCOME_DIVIDENDS", lastAmount: -40, averageAmount: -40 }),
    ]);
    expect([...ids]).toEqual(["payroll"]);
  });

  it("excludes income streams far smaller than the main paycheck", () => {
    const ids = paycheckStreamIds([
      stream("payroll", {}),
      stream("side-gig", { pfcDetailed: "INCOME_OTHER_INCOME", lastAmount: -900, averageAmount: -900 }),
      stream("tiny", { pfcDetailed: "INCOME_OTHER_INCOME", lastAmount: -20, averageAmount: -20 }),
    ]);
    expect([...ids].sort()).toEqual(["payroll", "side-gig"]);
  });

  it("returns nothing when the only income is interest (falls back to the default horizon)", () => {
    expect(
      paycheckStreamIds([stream("interest", { pfcDetailed: "INCOME_INTEREST_EARNED", lastAmount: -0.12 })]).size,
    ).toBe(0);
  });

  it("ignores inactive and non-income inflows", () => {
    const ids = paycheckStreamIds([
      stream("old-job", { isActive: false }),
      stream("venmo", { pfcPrimary: "TRANSFER_IN", pfcDetailed: "TRANSFER_IN_FROM_APPS" }),
    ]);
    expect(ids.size).toBe(0);
  });
});
