import { describe, expect, it } from "vitest";
import { parseTransactionQuery } from "@/lib/transactions/query";

describe("parseTransactionQuery", () => {
  it("drops an invalid date instead of crashing (?from=garbage)", () => {
    const q = parseTransactionQuery({ from: "garbage", to: "2026-08-31", search: "coffee" });
    expect(q.invalid).toEqual(["from"]);
    expect(q.filters.startDate).toBeUndefined();
    expect(q.filters.endDate?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(q.filters.search).toBe("coffee");
    expect(q.params).toEqual({ to: "2026-08-31", search: "coffee" });
  });

  it("validates enums and pages", () => {
    const q = parseTransactionQuery({
      flowClass: "not_a_class",
      flowGroup: "savings",
      cost: "fixed",
      recurring: "sometimes",
      page: "-3",
    });
    expect(q.invalid.sort()).toEqual(["flowClass", "page", "recurring"]);
    expect(q.filters.flowGroup).toBe("savings");
    expect(q.filters.cost).toBe("fixed");
    expect(q.page).toBe(1);
  });

  it("accepts flow classes and buckets from dashboard drill-downs", () => {
    const q = parseTransactionQuery({
      flowClass: "cash_withdrawal",
      bucket: "SENT_TO_PEOPLE",
      from: "2026-08-01",
      to: "2026-08-31",
      page: "2",
    });
    expect(q.invalid).toEqual([]);
    expect(q.filters.flowClass).toBe("cash_withdrawal");
    expect(q.filters.bucket).toBe("SENT_TO_PEOPLE");
    expect(q.page).toBe(2);
  });

  it("swaps a reversed range and takes the first of repeated keys", () => {
    const q = parseTransactionQuery({ from: "2026-08-31", to: "2026-08-01", account: ["a1", "a2"] });
    expect(q.filters.startDate?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(q.filters.endDate?.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(q.filters.accountId).toBe("a1");
  });

  it("rejects oversized text", () => {
    const q = parseTransactionQuery({ search: "x".repeat(500) });
    expect(q.invalid).toEqual(["search"]);
  });
});
