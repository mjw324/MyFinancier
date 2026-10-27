import { describe, expect, it } from "vitest";
import { checkFigures, checkScope, collectGrounding, extractFigures } from "@/lib/chat/guards";

const tool = {
  total: { cents: 123_456, display: "$1,234.56" },
  items: [
    { label: "Groceries", amount: { cents: 45_000, display: "$450.00" }, share: { value: 36, display: "36%" } },
    { label: "Dining", amount: { cents: 30_025, display: "$300.25" } },
  ],
  change: { delta: { cents: 10_000, display: "$100.00" }, pctChange: 9, pctChangeDisplay: "+9%" },
};
const g = collectGrounding([tool]);

describe("extractFigures", () => {
  it("reads currency with commas, cents and abbreviations, and percents", () => {
    const f = extractFigures("You spent $1,234.56, about $1.2k, up 9% or 12.5 percent.");
    expect(f.map((x) => [x.kind, x.value])).toEqual([
      ["money", 123_456],
      ["money", 120_000],
      ["percent", 9],
      ["percent", 12.5],
    ]);
  });
});

describe("checkFigures", () => {
  it("accepts figures copied from tool output, rounded or abbreviated", () => {
    expect(checkFigures("Total $1,234.56 ($1,235, roughly $1.2k). Groceries $450 was 36%, up 9%.", g).ok).toBe(true);
  });

  it("accepts trivial derivations: sums, differences and shares of grounded amounts", () => {
    // 450 + 300.25 = 750.25; 450 − 300.25 = 149.75; 450 / 1234.56 ≈ 36%
    expect(checkFigures("Together $750.25, a gap of $149.75.", g).ok).toBe(true);
  });

  it("flags figures the tools never returned", () => {
    const r = checkFigures("You spent $987.65 on coffee, 42% more than usual.", g);
    expect(r.ok).toBe(false);
    expect(r.unverified).toEqual(["$987.65", "42%"]);
  });

  it("passes an answer with no figures", () => {
    expect(checkFigures("Your dining spending went up.", g)).toEqual({ ok: true, checked: 0, unverified: [] });
  });
});

describe("checkScope", () => {
  it.each([
    "Should I buy Tesla stock?",
    "should i sell my bitcoin now",
    "Which ETF should I invest in?",
    "what's the best crypto to buy this year",
    "Can you recommend a good index fund?",
    "buy $NVDA?",
    "How should I allocate my 401k?",
  ])("blocks securities advice requests: %s", (q) => {
    expect(checkScope(q, "request").allowed).toBe(false);
  });

  it.each([
    "How much did I spend on groceries last month?",
    "What is an index fund?",
    "Should I pay off my credit card or build savings first?",
    "Explain the avalanche vs snowball method",
    "How much did I put into my brokerage account this year?",
    "Did I buy anything at Costco?",
  ])("allows budgeting and education: %s", (q) => {
    expect(checkScope(q, "request").allowed).toBe(true);
  });

  it("withholds an answer that recommends a security", () => {
    expect(checkScope("I recommend buying VTI stock with your extra cash.", "answer").allowed).toBe(false);
    expect(checkScope("You should consider investing in an S&P 500 index fund.", "answer").allowed).toBe(false);
    expect(checkScope("Index funds hold many stocks at once, which spreads risk.", "answer").allowed).toBe(true);
  });
});
