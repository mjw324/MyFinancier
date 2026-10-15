import { describe, expect, it } from "vitest";
import {
  computeDelta,
  computeDrift,
  detectAnomalies,
  monthKeys,
  seriesByBucket,
} from "@/lib/analytics/trends";

describe("computeDelta", () => {
  it("returns an unrounded ratio and suppresses it on a small base", () => {
    expect(computeDelta(150, 100).ratio).toBe(0.5);
    expect(computeDelta(4.4, 1).ratio).toBeNull();
    expect(computeDelta(4.4, 1).absolute).toBe(3.4);
    expect(computeDelta(100, 100).direction).toBe("flat");
  });
});

describe("computeDrift (medians)", () => {
  it("ignores a single large month such as a tax payment", () => {
    // Six complete months; one 3,214 payment three months ago.
    const series = new Map([["GOVERNMENT_AND_NON_PROFIT", [25, 3214, 25, 25, 25, 25]]]);
    expect(computeDrift(series)).toEqual([]);
  });

  it("reports a sustained change in the typical month", () => {
    const series = new Map([["GENERAL_MERCHANDISE", [400, 420, 410, 950, 960, 1000]]]);
    const [d] = computeDrift(series);
    expect(d.bucket).toBe("GENERAL_MERCHANDISE");
    expect(d.prior).toBe(410);
    expect(d.recent).toBe(960);
    expect(d.absolute).toBe(550);
    expect(d.direction).toBe("up");
  });

  it("needs two full windows", () => {
    expect(computeDrift(new Map([["X", [1, 500, 900]]]))).toEqual([]);
  });
});

describe("detectAnomalies", () => {
  const history = new Map([
    ["TRAVEL", [20, 25, 0, 30, 22, 24]],
    ["BANK_FEES", [1, 1, 1, 1, 1, 1]],
  ]);

  it("flags a bucket far above its typical month", () => {
    const [a] = detectAnomalies(new Map([["TRAVEL", 288]]), history);
    expect(a.bucket).toBe("TRAVEL");
    expect(a.typical).toBe(23);
    expect(a.ratio).toBeNull(); // typical under $50: no percentage
  });

  it("suppresses small bases and offset buckets", () => {
    expect(detectAnomalies(new Map([["BANK_FEES", 4.4]]), history)).toEqual([]);
    expect(
      detectAnomalies(new Map([["REIMBURSEMENTS", 900]]), new Map([["REIMBURSEMENTS", [1, 1, 1]]])),
    ).toEqual([]);
  });
});

describe("monthly series", () => {
  it("aligns bucket totals to months and fills gaps with 0", () => {
    const months = monthKeys(new Date("2026-05-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z"));
    expect(months).toEqual(["2026-05", "2026-06", "2026-07"]);
    const s = seriesByBucket(
      [
        { month: "2026-05", bucket: "FOOD_AND_DRINK", net: 100 },
        { month: "2026-07", bucket: "FOOD_AND_DRINK", net: 300 },
        { month: "2026-07", bucket: "REIMBURSEMENTS", net: -50 },
      ],
      months,
    );
    expect(s.get("FOOD_AND_DRINK")).toEqual([100, 0, 300]);
    expect(s.has("REIMBURSEMENTS")).toBe(false);
  });
});
