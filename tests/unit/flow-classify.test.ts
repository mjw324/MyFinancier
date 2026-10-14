import { describe, expect, it } from "vitest";
import {
  classifyFlow,
  brandTokens,
  mentionsBrand,
  type ClassifyContext,
  type FlowAccount,
  type FlowTxn,
} from "@/lib/analytics/flow-classify";
import { counterpartyKey, extractPersonName } from "@/lib/analytics/counterparty";

// Synthetic fixtures only. Institutions, people and amounts are invented.
const checking: FlowAccount = {
  id: "chk",
  type: "depository",
  subtype: "checking",
  name: "Everyday Checking",
  institutionName: "Northwind Bank",
  historyStart: "2025-01-01",
  historyEnd: "2026-06-30",
};
const card: FlowAccount = {
  id: "card",
  type: "credit",
  subtype: "credit card",
  name: "Contoso Rewards Card",
  institutionName: "Contoso",
  historyStart: "2025-06-01",
  historyEnd: "2026-06-28",
};
const wallet: FlowAccount = {
  id: "wallet",
  type: "depository",
  subtype: "checking",
  name: "Personal Profile",
  institutionName: "Venmo - Personal",
  historyStart: "2024-01-01",
  historyEnd: "2026-06-29",
};
const brokerageCard: FlowAccount = {
  id: "bcard",
  type: "credit",
  name: "Fabrikam Credit Card",
  institutionName: "Fabrikam Invest",
  historyStart: "2025-03-01",
  historyEnd: "2026-06-29",
};
const brokerage: FlowAccount = {
  id: "inv",
  type: "investment",
  subtype: "brokerage",
  name: "Fabrikam Roth IRA",
  institutionName: "Fabrikam Invest",
  historyStart: null,
  historyEnd: null,
};
const loan: FlowAccount = { id: "loan", type: "loan", name: "Student Loan", institutionName: "Tailspin Lending" };

const ctx: ClassifyContext = {
  accounts: [checking, card, wallet, brokerageCard, brokerage, loan],
  userName: "Alex Sample",
};

function txn(over: Partial<FlowTxn>): FlowTxn {
  return { amount: "10.00", date: "2026-03-15", name: "Test", ...over };
}

const classify = (t: Partial<FlowTxn>, a: FlowAccount = checking) => classifyFlow(txn({ accountId: a.id, ...t }), a, ctx);

describe("classifyFlow — basics and precedence", () => {
  it("zero amounts are zero", () => {
    expect(classify({ amount: "0" })).toBe("zero");
  });

  it("ordinary purchases are spending; merchant-category inflows are refunds", () => {
    expect(classify({ amount: "12.50", category: "FOOD_AND_DRINK", name: "Coffee Shop" }, card)).toBe("spending");
    expect(classify({ amount: "-12.50", category: "FOOD_AND_DRINK", name: "Coffee Shop" }, checking)).toBe("refund");
  });

  it("a manual class wins over everything, including a validated pair (review S2)", () => {
    const t = {
      amount: "10.00",
      category: "GENERAL_SERVICES",
      flowClass: "spending",
      flowClassSource: "manual",
      pairPartner: { accountId: "wallet", amount: "-10.00", accountType: "depository" },
    };
    expect(classify(t, card)).toBe("spending");
  });

  it("a validated pair is internal: cc_payment with a card leg, internal_transfer otherwise", () => {
    expect(
      classify(
        {
          amount: "250.00",
          category: "TRANSFER_OUT",
          categoryId: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
          name: "Fabrikam",
          pairPartner: { accountId: "bcard", amount: "-250.00", accountType: "credit" },
        },
        checking,
      ),
    ).toBe("cc_payment");
    expect(
      classify(
        {
          amount: "-40.00",
          category: "TRANSFER_IN",
          name: "Venmo",
          pairPartner: { accountId: "wallet", amount: "40.00", accountType: "depository" },
        },
        checking,
      ),
    ).toBe("internal_transfer");
  });

  it("ignores a dangling or mismatched pair partner", () => {
    const base = { amount: "10.00", category: "GENERAL_SERVICES", name: "Car Wash" };
    expect(classify({ ...base, pairPartner: { accountId: "wallet", amount: "-9.99", accountType: "depository" } }, card)).toBe("spending");
    expect(classify({ ...base, pairPartner: { accountId: "wallet", amount: "10.00", accountType: "depository" } }, card)).toBe("spending");
    expect(classify({ ...base, pairPartner: { accountId: "card", amount: "-10.00", accountType: "credit" } }, card)).toBe("spending");
  });
});

describe("credit card inflows (review S3/S4)", () => {
  it("rewards beat payment wording", () => {
    expect(classify({ amount: "-12.00", category: "OTHER", categoryId: "OTHER_OTHER", name: "Thankyou Points Redeemed TY 123" }, card)).toBe("card_reward");
    expect(classify({ amount: "-9.00", category: "OTHER", name: "PAYYOURSELFBACK CREDIT" }, card)).toBe("card_reward");
    expect(classify({ amount: "-3.00", category: "TRANSFER_IN", name: "AUTOMATIC STATEMENT CREDIT" }, card)).toBe("card_reward");
    expect(classify({ amount: "-20.00", category: "OTHER", name: "CREDIT-CASH BACK REWARD" }, card)).toBe("card_reward");
  });

  it("payments in the window of a linked bank are card payments, whatever Plaid calls them", () => {
    const d = { date: "2026-06-28" }; // checking history ends 06-30 → in flight
    expect(classify({ ...d, amount: "-500.00", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", name: "Payment" }, card)).toBe("cc_payment");
    expect(classify({ ...d, amount: "-500.00", category: "LOAN_DISBURSEMENTS", name: "Payment Thank You-Mobile" }, card)).toBe("cc_payment");
    expect(classify({ ...d, amount: "-500.00", category: "INCOME", categoryId: "INCOME_SALARY", name: "AUTOMATIC PAYMENT - THANK" }, card)).toBe("cc_payment");
  });

  it("an unpaired card payment from outside the linked banks' data is a move from the user's other account", () => {
    // Checking history starts 2025-01-01: a payment before that came from money this app never saw.
    expect(classify({ date: "2024-11-01", amount: "-300.00", category: "LOAN_DISBURSEMENTS", name: "Payment Thank You" }, card)).toBe("external_transfer_in");
    // Inside the bank's history but no matching debit: paid from elsewhere.
    expect(classify({ date: "2026-02-01", amount: "-300.00", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", name: "Payment" }, card)).toBe("external_transfer_in");
  });

  it("merchant credits Plaid labels INCOME are refunds, not rewards (review S4)", () => {
    expect(classify({ amount: "-80.00", category: "INCOME", categoryId: "INCOME_OTHER", name: "Garden Outlet" }, card)).toBe("refund");
    expect(classify({ amount: "-27.00", category: "OTHER", name: "Credit for Dispute" }, card)).toBe("refund");
    expect(classify({ amount: "-15.00", category: "TRANSFER_IN", name: "SHOEBRANDA" }, card)).toBe("refund");
  });

  it("cash advances and card purchases routed through payment apps", () => {
    expect(classify({ amount: "200.00", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_WITHDRAWAL", name: "CASH ADVANCE" }, card)).toBe("cash_withdrawal");
    expect(classify({ amount: "45.00", category: "TRANSFER_OUT", name: "ART PRINT SHOP" }, card)).toBe("spending");
    expect(classify({ amount: "45.00", category: "TRANSFER_OUT", name: "VENMO *Jamie Doe" }, card)).toBe("p2p_payment");
  });

  it("anything paid onto a loan account is a payment toward it", () => {
    expect(classify({ amount: "-150.00", date: "2026-06-28", category: "LOAN_PAYMENTS", name: "PAYMENT RECEIVED" }, { ...loan })).toBe("cc_payment");
  });
});

describe("bank outflows", () => {
  it("card payments: linked + in flight → internal; pre-history or no matching credit → debt service; unlinked → debt", () => {
    const pay = { category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", name: "CONTOSO ONLINE PAYMENT 123", amount: "400.00" };
    expect(classify({ ...pay, date: "2026-06-27" })).toBe("cc_payment");
    expect(classify({ ...pay, date: "2025-03-01" })).toBe("debt_payment"); // card history starts 2025-06-01
    expect(classify({ ...pay, date: "2026-01-15" })).toBe("debt_payment"); // covered, but unpaired
    expect(classify({ ...pay, name: "OTHERBANK CARD PAYMENT", date: "2026-06-27" })).toBe("debt_payment");
  });

  it("brand matching is whole-word: a short brand never matches a longer word (review S5)", () => {
    const shortBrand: FlowAccount = { ...card, id: "c2", name: "Nova Custom Cash Card", institutionName: "Novabank Online" };
    const c2: ClassifyContext = { accounts: [checking, shortBrand] };
    const pay = (name: string) =>
      classifyFlow(
        txn({ name, amount: "100.00", date: "2026-06-27", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
        checking,
        c2,
      );
    expect(pay("NOVA AUTOPAY PAYMENT 1234")).toBe("cc_payment");
    expect(pay("NOVATEL CARD PAYMENT 1234")).toBe("debt_payment");
    expect(mentionsBrand(["outlook"], ["look"])).toBe(false);
    expect(brandTokens("Fabrikam Roth IRA")).toEqual(["fabrikam"]);
  });

  it("an investment-labelled debit is saving unless it pays a card (caught by pairing)", () => {
    const inv = { amount: "300.00", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", name: "Fabrikam" };
    expect(classify(inv)).toBe("savings_out");
    expect(classify({ ...inv, pairPartner: { accountId: "bcard", amount: "-300.00", accountType: "credit" } })).toBe("cc_payment");
  });

  it("loans, ATM cash, checks and people", () => {
    expect(classify({ amount: "250.00", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", name: "STUDENT LN PAYMENT" })).toBe("debt_payment");
    expect(classify({ amount: "100.00", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_WITHDRAWAL", name: "ATM WITHDRAWAL 0001" })).toBe("cash_withdrawal");
    expect(classify({ amount: "900.00", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_ACCOUNT_TRANSFER", name: "Check 101" })).toBe("p2p_payment");
    expect(classify({ amount: "60.00", category: "TRANSFER_OUT", name: "Zelle payment to JAMIE DOE ABC123XYZ9" })).toBe("p2p_payment");
  });

  it("a debit funding a linked wallet is internal (the wallet records the payment); unlinked wallet → sent to someone", () => {
    const fund = { amount: "25.00", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS", name: "Venmo" };
    expect(classify(fund)).toBe("internal_transfer");
    expect(classify({ ...fund, name: "PAYPAL INST XFER" })).toBe("p2p_payment");
  });

  it("transfers naming the user are moves to their own (unlinked) account", () => {
    expect(classify({ amount: "1000.00", category: "TRANSFER_OUT", name: "SAMPLE ALEX TRANSFER WEB ID 1" })).toBe("external_transfer_out");
  });
});

describe("payment-app wallet (review S8)", () => {
  const out = { category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_ACCOUNT_TRANSFER" };
  it("cash-out to a linked bank in flight is internal; to an unlinked or out-of-window bank it moved outside", () => {
    expect(classify({ ...out, amount: "120.00", date: "2026-06-28", name: "Standard transfer" }, wallet)).toBe("internal_transfer");
    expect(classify({ ...out, amount: "120.00", date: "2024-06-01", name: "Standard transfer" }, wallet)).toBe("external_transfer_out");
    expect(
      classify({ ...out, amount: "120.00", date: "2026-06-28", name: "Standard transfer To Example State Bank Checking (..1234)" }, wallet),
    ).toBe("external_transfer_out");
    expect(
      classify({ ...out, amount: "120.00", date: "2026-06-28", name: "Instant transfer To Northwind Bank Checking" }, wallet),
    ).toBe("internal_transfer");
  });

  it("never treats a cash-out as a payment to a person", () => {
    expect(classify({ ...out, amount: "50.00", date: "2026-02-01", name: "Instant transfer" }, wallet)).not.toBe("p2p_payment");
  });

  it("payments to people are p2p even when Plaid gives a merchant category", () => {
    expect(classify({ amount: "40.00", category: "FOOD_AND_DRINK", name: 'Jamie Doe "pizza night"' }, wallet)).toBe("p2p_payment");
    expect(classify({ amount: "25.00", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", name: 'Jamie Doe "stock tip"' }, wallet)).toBe("p2p_payment");
  });

  it("money from people is a reimbursement (product decision 1), incl. INCOME-labelled receipts", () => {
    expect(classify({ amount: "-500.00", category: "OTHER", categoryId: "OTHER_OTHER", name: 'Roommate A "rent share"' }, wallet)).toBe("reimbursement");
    expect(classify({ amount: "-35.00", category: "INCOME", categoryId: "INCOME_OTHER", name: 'Roommate A "utilities"' }, wallet)).toBe("reimbursement");
    expect(classify({ amount: "-35.00", category: "RENT_AND_UTILITIES", name: 'Roommate A "utilities"' }, wallet)).toBe("reimbursement");
  });

  it("a user-set INCOME category on a wallet receipt makes it income; a merchant category keeps it a reimbursement", () => {
    expect(classify({ amount: "-80.00", category: "OTHER", name: 'Client B "design work"', customCategory: "INCOME" }, wallet)).toBe("income");
    expect(classify({ amount: "-500.00", category: "OTHER", name: 'Roommate A "rent"', customCategory: "RENT_AND_UTILITIES" }, wallet)).toBe("reimbursement");
  });
});

describe("bank inflows", () => {
  it("income, tax refunds, rewards paid to the bank", () => {
    expect(classify({ amount: "-2000.00", category: "INCOME", categoryId: "INCOME_WAGES", name: "ACME CORP PAYROLL" })).toBe("income");
    expect(classify({ amount: "-25.00", category: "INCOME", categoryId: "INCOME_OTHER", name: "CONTOSO CASH REWARD" })).toBe("card_reward");
    expect(classify({ amount: "-20.00", category: "OTHER", name: "Cash Redemption" })).toBe("card_reward");
  });

  it("wages Plaid files under a merchant category are still income", () => {
    expect(classify({ amount: "-810.00", category: "FOOD_AND_DRINK", name: "Salad Chain inc payroll ppd id" })).toBe("income");
    expect(classify({ amount: "-810.00", category: "FOOD_AND_DRINK", name: "Salad Chain refund" })).toBe("refund");
  });

  it("Venmo and Zelle receipts are both reimbursements; wallet cash-out arrival is internal", () => {
    expect(classify({ amount: "-60.00", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_TRANSFER_IN_FROM_APPS", name: "Zelle payment from JAMIE DOE ABC123XYZ9" })).toBe("reimbursement");
    expect(classify({ amount: "-60.00", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_TRANSFER_IN_FROM_APPS", name: "Venmo" })).toBe("internal_transfer");
    expect(classify({ amount: "-60.00", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_TRANSFER_IN_FROM_APPS", name: "PAYPAL TRANSFER" })).toBe("reimbursement");
  });

  it("brokerage withdrawals are savings_in, not income (review S6)", () => {
    expect(classify({ amount: "-1000.00", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_ACCOUNT_TRANSFER", name: "Fabrikam" })).toBe("savings_in");
    expect(classify({ amount: "-5.00", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS", name: "ROBO INVEST" })).toBe("savings_in");
  });

  it("deposits and unknown transfers are other money in, not reimbursements", () => {
    expect(classify({ amount: "-300.00", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_DEPOSIT", name: "ATM CASH DEPOSIT" })).toBe("other_inflow");
    expect(classify({ amount: "-300.00", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_OTHER_TRANSFER_IN", name: "Mobile Deposit" })).toBe("other_inflow");
    expect(classify({ amount: "-0.25", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_ACCOUNT_TRANSFER", name: "ACCTVERIFY" })).toBe("other_inflow");
  });

  it("loan-category and bank-fee inflows are refunds of spending, never a payment to a loan (old refund detector)", () => {
    expect(classify({ amount: "-35.00", category: "BANK_FEES", name: "FEE REVERSAL" })).toBe("refund");
  });
});

describe("custom category as rule input", () => {
  it("a user retagging a mislabelled transfer as a purchase makes it spending", () => {
    expect(classify({ amount: "190.00", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_ACCOUNT_TRANSFER", name: "ODD MERCHANT 12", customCategory: "GENERAL_MERCHANDISE" })).toBe("spending");
  });
  it("a user label on a check keeps it a payment to someone", () => {
    expect(classify({ amount: "1000.00", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_ACCOUNT_TRANSFER", name: "Check 12", customCategory: "TRANSFER_OUT" })).toBe("p2p_payment");
  });
});

describe("counterparty", () => {
  it("extracts people from payment-app and Zelle formats, never the note", () => {
    expect(extractPersonName('Jamie Doe "pizza"')).toBe("Jamie Doe");
    expect(extractPersonName("Zelle payment from JAMIE DOE ABC123XYZ9")).toBe("JAMIE DOE");
    expect(extractPersonName("COFFEE SHOP 123")).toBeNull();
    expect(counterpartyKey({ name: 'Jamie Doe "pizza"' })).toBe("jamie doe");
    expect(counterpartyKey({ name: 'Jamie Doe "rent"' })).toBe("jamie doe");
  });
  it("prefers custom name, then merchant, then mechanisms", () => {
    expect(counterpartyKey({ name: "X", customName: "My Gym" })).toBe("my gym");
    expect(counterpartyKey({ name: "SQ *COFFEE 123", merchantName: "Coffee Shop" })).toBe("coffee shop");
    expect(counterpartyKey({ name: "ATM WITHDRAWAL 000123 04/04" })).toBe("atm withdrawal");
    expect(counterpartyKey({ name: "Standard transfer" })).toBe("account transfer");
  });
});
