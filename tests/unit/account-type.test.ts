import { describe, it, expect } from "vitest";
import {
  isLiabilityType,
  signedBalance,
} from "@/lib/utils/account-type";

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

describe("signedBalance", () => {
  it("returns the balance unchanged for asset types", () => {
    expect(signedBalance("depository", "1000.00")).toBe(1000);
    expect(signedBalance("investment", 2500)).toBe(2500);
  });

  it("negates the balance for liability types", () => {
    expect(signedBalance("credit", "75.25")).toBe(-75.25);
    expect(signedBalance("loan", 500)).toBe(-500);
  });

  it("returns 0 for null balances", () => {
    expect(signedBalance("depository", null)).toBe(0);
    expect(signedBalance("credit", null)).toBe(-0);
  });

  it("returns 0 for unparseable strings instead of NaN", () => {
    expect(signedBalance("depository", "not-a-number")).toBe(0);
    expect(Number.isNaN(signedBalance("credit", "abc"))).toBe(false);
  });

  it("handles numeric input directly", () => {
    expect(signedBalance("depository", 42.5)).toBe(42.5);
    expect(signedBalance("loan", 100)).toBe(-100);
  });
});
