import { describe, it, expect } from "vitest";
import {
  normalizeMerchant,
  computeNameSignature,
} from "@/lib/utils/spending-match";

describe("normalizeMerchant", () => {
  it("returns null for null/empty input", () => {
    expect(normalizeMerchant(null)).toBeNull();
    expect(normalizeMerchant(undefined)).toBeNull();
    expect(normalizeMerchant("")).toBeNull();
    expect(normalizeMerchant("   ")).toBeNull();
  });

  it("strips trailing state code and store id", () => {
    expect(
      normalizeMerchant("WHOLEFDS WFM #10342 PHILADELPHIA PA"),
    ).toBe("wholefds wfm philadelphia");
  });

  it("strips trailing two-letter state and single-char tokens", () => {
    expect(normalizeMerchant("Trader Joe's Cambridge MA")).toBe(
      "trader joe cambridge",
    );
  });
});

describe("computeNameSignature", () => {
  it("returns null for null/empty input", () => {
    expect(computeNameSignature(null)).toBeNull();
    expect(computeNameSignature(undefined)).toBeNull();
    expect(computeNameSignature("")).toBeNull();
  });

  it("is stable across order ids on Amazon Marketplace", () => {
    const a = computeNameSignature("AMZN Mktp US*RT4G91KZ3");
    const b = computeNameSignature("AMZN Mktp US*ZQ91XX112");
    expect(a).toBe(b);
    expect(a).toBe("amzn mktp us");
  });

  it("produces a stable Uber signature (drops trailing dot-com)", () => {
    const a = computeNameSignature("Uber *Trip Help.uber.com");
    const b = computeNameSignature("Uber *Trip 87654-Help.uber.com");
    expect(a).toBe(b);
  });

  it("matches Whole Foods rows that differ only by store number", () => {
    const a = computeNameSignature("WHOLEFDS #123 SOMEWHERE");
    const b = computeNameSignature("WHOLEFDS #456 SOMEWHERE");
    expect(a).toBe(b);
    expect(a).toBe("wholefds somewhere");
  });

  it("keeps at most three tokens", () => {
    const sig = computeNameSignature("ALPHA BETA GAMMA DELTA EPSILON");
    expect(sig?.split(" ").length).toBeLessThanOrEqual(3);
    expect(sig).toBe("alpha beta gamma");
  });

  it("drops pure noise tokens", () => {
    expect(computeNameSignature("POS PURCHASE DEBIT XXXX 1234")).toBeNull();
  });
});
