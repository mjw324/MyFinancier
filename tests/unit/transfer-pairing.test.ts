import { describe, expect, it } from "vitest";
import { planTransferPairs, applyPairPlanToRows, type PairRow } from "@/lib/plaid/transfers";
import type { ClassifyContext, FlowAccount } from "@/lib/analytics/flow-classify";

// Synthetic fixtures only.
const checking: FlowAccount = { id: "chk", type: "depository", name: "Checking", institutionName: "Northwind Bank" };
const card: FlowAccount = { id: "card", type: "credit", name: "Fabrikam Credit Card", institutionName: "Fabrikam Invest" };
const wallet: FlowAccount = { id: "wallet", type: "depository", name: "Personal Profile", institutionName: "Venmo - Personal" };
const accounts = [checking, card, wallet];
const ctx: ClassifyContext = { accounts, userName: "Alex Sample" };

let n = 0;
function row(over: Partial<PairRow>): PairRow {
  n += 1;
  return { id: `r${String(n).padStart(3, "0")}`, accountId: "chk", amount: "10.00", date: "2026-03-10", name: "Test", ...over };
}

function plan(rows: PairRow[]) {
  let i = 0;
  return planTransferPairs(rows, accounts, ctx, () => `p${++i}`);
}

describe("planTransferPairs", () => {
  it("pairs a card payment Plaid labels as an investment transfer with the card's credit (review §4.1)", () => {
    const bank = row({ amount: "412.57", date: "2026-04-14", name: "Fabrikam", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS" });
    const cardLeg = row({ accountId: "card", amount: "-412.57", date: "2026-04-11", name: "Payment", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" });
    const p = plan([bank, cardLeg]);
    expect(p.create).toEqual([{ pairId: "p1", outId: bank.id, inId: cardLeg.id }]);
  });

  it("never pairs a purchase with an unrelated person-to-person receipt (the false-pair type)", () => {
    const carWash = row({ accountId: "card", amount: "12.00", date: "2026-02-10", name: "CAR WASH", category: "GENERAL_SERVICES" });
    const receipt = row({ accountId: "wallet", amount: "-12.00", date: "2026-02-11", name: 'Friend B "snacks"', category: "OTHER", categoryId: "OTHER_OTHER" });
    expect(plan([carWash, receipt]).create).toEqual([]);
  });

  it("never pairs a purchase with a wallet cash-out arrival even though the arrival carries transfer evidence", () => {
    const lunch = row({ accountId: "card", amount: "25.00", name: "LUNCH PLACE", category: "FOOD_AND_DRINK" });
    const arrival = row({ amount: "-25.00", name: "Venmo", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_TRANSFER_IN_FROM_APPS" });
    expect(plan([lunch, arrival]).create).toEqual([]);
  });

  it("requires transfer evidence on at least one leg", () => {
    const a = row({ amount: "50.00", name: "Thing", category: "OTHER" });
    const b = row({ accountId: "wallet", amount: "-50.00", name: "Other thing", category: "OTHER" });
    expect(plan([a, b]).create).toEqual([]);
  });

  it("never pairs pending rows, rows on the same account, or rows more than 5 days apart", () => {
    const out = { amount: "100.00", name: "Standard transfer", category: "TRANSFER_OUT", accountId: "wallet" };
    const inn = { amount: "-100.00", name: "Venmo", category: "TRANSFER_IN" };
    expect(plan([row({ ...out, pending: true }), row(inn)]).create).toEqual([]);
    expect(plan([row(out), row({ ...inn, accountId: "wallet" })]).create).toEqual([]);
    expect(plan([row({ ...out, date: "2026-03-01" }), row({ ...inn, date: "2026-03-07" })]).create).toEqual([]);
    expect(plan([row({ ...out, date: "2026-03-01" }), row({ ...inn, date: "2026-03-06" })]).create).toHaveLength(1);
  });

  it("prefers the closest date and breaks ties deterministically", () => {
    const out = row({ accountId: "wallet", amount: "200.00", date: "2026-03-10", name: "Standard transfer", category: "TRANSFER_OUT" });
    const far = row({ amount: "-200.00", date: "2026-03-13", name: "Venmo", category: "TRANSFER_IN" });
    const near = row({ amount: "-200.00", date: "2026-03-11", name: "Venmo", category: "TRANSFER_IN" });
    expect(plan([out, far, near]).create[0].inId).toBe(near.id);
    const twinA = row({ amount: "-200.00", date: "2026-03-11", name: "Venmo", category: "TRANSFER_IN" });
    const r1 = plan([out, twinA, near]).create[0].inId;
    const r2 = plan([near, twinA, out]).create[0].inId;
    expect(r1).toBe(r2);
  });

  it("clears orphaned and invalid existing pairs, then re-pairs the survivor with its real partner", () => {
    const orphan = row({ accountId: "card", amount: "-75.00", date: "2026-04-02", name: "Payment", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", transferPairId: "old-1" });
    const posted = row({ amount: "75.00", date: "2026-04-03", name: "FABRIKAM CARD PAYMENT", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" });
    const falseA = row({ accountId: "card", amount: "10.00", name: "CAR WASH", category: "GENERAL_SERVICES", transferPairId: "old-2" });
    const falseB = row({ accountId: "wallet", amount: "-10.00", name: 'Friend B "x"', category: "OTHER", transferPairId: "old-2" });
    const p = plan([orphan, posted, falseA, falseB]);
    expect(p.clear.sort()).toEqual(["old-1", "old-2"]);
    expect(p.create).toEqual([{ pairId: "p1", outId: posted.id, inId: orphan.id }]);
    const after = applyPairPlanToRows([orphan, posted, falseA, falseB], p);
    expect(after.map((r) => r.transferPairId)).toEqual(["p1", "p1", null, null]);
  });

  it("keeps a valid existing pair and does not pair manual rows", () => {
    const a = row({ amount: "60.00", name: "Venmo", category: "TRANSFER_OUT", transferPairId: "keep" });
    const b = row({ accountId: "wallet", amount: "-60.00", name: "Transfer from bank", category: "TRANSFER_IN", transferPairId: "keep" });
    const c = row({ amount: "70.00", name: "Venmo", category: "TRANSFER_OUT", flowClassSource: "manual", flowClass: "p2p_payment" });
    const d = row({ accountId: "wallet", amount: "-70.00", name: "Transfer from bank", category: "TRANSFER_IN" });
    const p = plan([a, b, c, d]);
    expect(p.clear).toEqual([]);
    expect(p.create).toEqual([]);
  });

  it("allows pending legs only when asked (provisional pairs for classification)", () => {
    const bank = row({ amount: "40.00", name: "Fabrikam", category: "TRANSFER_OUT", pending: true });
    const cardLeg = row({ accountId: "card", amount: "-40.00", name: "Payment", category: "LOAN_PAYMENTS" });
    expect(planTransferPairs([bank, cardLeg], accounts, ctx).create).toEqual([]);
    expect(planTransferPairs([bank, cardLeg], accounts, ctx, () => "x", { allowPending: true }).create).toHaveLength(1);
  });
});
