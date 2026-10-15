import { describe, it, expect } from "vitest";
import { isLiabilityType } from "@/lib/utils/account-type";

describe("isLiabilityType", () => {
  it("returns true for credit accounts", () => {
    expect(isLiabilityType("credit")).toBe(true);
  });

  it("returns true for loan accounts", () => {
    expect(isLiabilityType("loan")).toBe(true);
  });

  it("returns false for depository accounts", () => {
    expect(isLiabilityType("depository")).toBe(false);
  });

  it("returns false for investment accounts", () => {
    expect(isLiabilityType("investment")).toBe(false);
  });

  it("returns false for brokerage accounts", () => {
    expect(isLiabilityType("brokerage")).toBe(false);
  });

  it("returns false for unknown / 'other' types", () => {
    expect(isLiabilityType("other")).toBe(false);
    expect(isLiabilityType("")).toBe(false);
    expect(isLiabilityType("not-a-real-type")).toBe(false);
  });
});

