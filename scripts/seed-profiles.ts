/**
 * Development profiles for scripts/seed-dev.ts.
 *
 * Each profile is a set of Plaid sandbox Items. A `custom` Item is a Plaid
 * "user_custom" sandbox user whose accounts and transactions are generated
 * here (https://plaid.com/docs/sandbox/user-custom/): Plaid enriches them
 * (merchant, personal_finance_category) and detects recurring streams exactly
 * as it would for a real bank, so the data runs through the app's full sync,
 * flow-classification, transfer-pairing and recurring pipeline.
 *
 * Generation is deterministic (seeded per profile) and relative to today, so
 * every seed produces the same shape of data ending yesterday.
 *
 * Coverage map (what each profile exists to exercise):
 *   alex     salaried renter, 2 years, 3 banks: biweekly paycheck (safe-to-spend
 *            anchor), bills + subscriptions with a price change, a cancelled
 *            and a new subscription (bill calendar, stale/early streams), card autopay pairs (cc_payment), checking↔savings pairs
 *            (internal_transfer), IRA contributions (savings_out), interest +
 *            tax refund (other_inflow), refunds, card rewards, Venmo/Zelle in
 *            and out (reimbursement / p2p_payment), ATM (cash_withdrawal),
 *            cheque deposits (other_inflow), a brokerage withdrawal
 *            (savings_in), a $0 authorisation (zero),
 *            student-loan payments (debt_payment), a travel spike (trends,
 *            insights), budgets over/under on every period, spending rules,
 *            customised names/categories.
 *   jordan   freelancer, 1 year: irregular client income (no paycheck anchor →
 *            30-day safe-to-spend horizon), quarterly IRS payments, PayPal
 *            cash-outs, card carrying a balance with no payment schedule,
 *            cash-heavy spending.
 *   taylor   family homeowner, 18 months, 3 banks: two salaries, mortgage + auto
 *            loan, childcare, semi-annual insurance and yearly bills, seasonal
 *            utilities, transfers to the user's unlinked account
 *            (external_transfer_out/in), a 529 withdrawal (savings_in),
 *            and one connection that needs a re-login (Settings reconnect).
 *   sammy    student, 10 weeks: weekly part-time pay, money from parents, thin
 *            balances and a near-zero checking account (new-user states).
 *   newbie   signed up, nothing linked (every empty state).
 *   dynamic  Plaid's user_transactions_dynamic: new transactions on each refresh.
 */

import { SYNTHETIC_BUCKETS } from "@/lib/analytics/flow";

/** Plaid rejects /sandbox/public_token/create bodies over ~100 KB with 413. */
export const MAX_CUSTOM_CONFIG_BYTES = 90_000;

/** The user_custom password: the Item's accounts as Plaid's config JSON. */
export function customConfig(accounts: CustomAccount[]): string {
  return JSON.stringify({ override_accounts: accounts });
}

export type CustomTxn = {
  date_transacted: string;
  date_posted: string;
  amount: number;
  description: string;
  currency: "USD";
};

export type CustomAccount = {
  type: "depository" | "credit" | "loan" | "investment";
  subtype: string;
  starting_balance: number;
  meta: { name: string; mask: string };
  transactions: CustomTxn[];
};

export type ItemSpec =
  | { kind: "custom"; institutionId: string; accounts: CustomAccount[]; loginRequired?: boolean }
  | { kind: "persona"; institutionId: string; plaidUser: string };

export type BudgetSpec = {
  categoryKey: string;
  amount: number;
  period: "weekly" | "monthly" | "yearly";
  /** Days before today the budget starts. */
  startDaysAgo: number;
};

export type Profile = {
  username: string;
  name: string;
  description: string;
  timeZone?: string;
  items: ItemSpec[];
  budgets?: BudgetSpec[];
  /** Spending rules (merchant match), applied after the sync. */
  spendingRules?: Array<{ merchant: string; spendingType: "necessary" | "discretionary" }>;
  /** Recurring streams (matched by description substring) to classify. */
  streamTypes?: Array<{ match: string; spendingType: "necessary" | "discretionary" }>;
  /** Display overrides (matched by description substring) to apply after the sync. */
  overrides?: Array<{ match: string; customName?: string; customCategory?: string }>;
};

// ---------------------------------------------------------------------------
// Generation helpers
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

/** mulberry32: small deterministic PRNG. */
function rng(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A ledger of accounts for one profile; dates are "days ago" (≥ 1). */
class Ledger {
  readonly rand: () => number;
  private readonly today = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  private readonly txns = new Map<string, CustomTxn[]>();

  constructor(seed: string, readonly days: number) {
    this.rand = rng(seed);
  }

  between(min: number, max: number): number {
    return round2(min + this.rand() * (max - min));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rand() * items.length)];
  }

  add(account: string, daysAgo: number, amount: number, description: string, postLag = 0): void {
    if (daysAgo < 1 || daysAgo > this.days) return;
    const posted = Math.max(1, daysAgo - postLag);
    const list = this.txns.get(account) ?? [];
    list.push({
      date_transacted: this.iso(daysAgo),
      date_posted: this.iso(posted),
      amount: round2(amount),
      description,
      currency: "USD",
    });
    this.txns.set(account, list);
  }

  /** Both legs of a movement between two linked accounts (out leg positive). */
  transfer(from: string, to: string, daysAgo: number, amount: number, outDesc: string, inDesc: string, lag = 1): void {
    this.add(from, daysAgo, amount, outDesc);
    this.add(to, Math.max(1, daysAgo - lag), -amount, inDesc);
  }

  /** "Days ago" of day-of-month `dom` for each month in range, newest first. */
  monthly(dom: number): number[] {
    const out: number[] = [];
    const now = new Date(this.today);
    for (let m = 0; ; m++) {
      const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, Math.min(dom, 28));
      const ago = Math.round((this.today - d) / DAY);
      if (ago > this.days) break;
      if (ago >= 1) out.push(ago);
    }
    return out;
  }

  /** "Days ago" every `interval` days starting `offset` days ago. */
  every(interval: number, offset: number): number[] {
    const out: number[] = [];
    for (let ago = offset; ago <= this.days; ago += interval) out.push(ago);
    return out;
  }

  /** `perWeek` random purchases spread over the history. */
  scatter(perWeek: number): number[] {
    const n = Math.round((this.days / 7) * perWeek);
    return Array.from({ length: n }, () => 1 + Math.floor(this.rand() * this.days));
  }

  /** Month index (0 = current month) of a "days ago". */
  monthOf(daysAgo: number): number {
    const d = new Date(this.today - daysAgo * DAY);
    const now = new Date(this.today);
    return (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + now.getUTCMonth() - d.getUTCMonth();
  }

  /** Calendar month (1–12) of a "days ago". */
  calendarMonth(daysAgo: number): number {
    return new Date(this.today - daysAgo * DAY).getUTCMonth() + 1;
  }

  account(
    key: string,
    type: CustomAccount["type"],
    subtype: string,
    name: string,
    mask: string,
    balance: number,
  ): CustomAccount {
    const transactions = (this.txns.get(key) ?? []).sort((a, b) =>
      a.date_posted.localeCompare(b.date_posted),
    );
    return { type, subtype, starting_balance: balance, meta: { name, mask }, transactions };
  }

  private iso(daysAgo: number): string {
    return new Date(this.today - daysAgo * DAY).toISOString().slice(0, 10);
  }
}

type Merchant = { desc: string; min: number; max: number };

const GROCERIES: Merchant[] = [
  { desc: "WHOLE FOODS MARKET #10234", min: 35, max: 160 },
  { desc: "TRADER JOE S #552", min: 25, max: 95 },
  { desc: "SAFEWAY #1782", min: 20, max: 140 },
  { desc: "COSTCO WHSE #0482", min: 90, max: 320 },
];
const DINING: Merchant[] = [
  { desc: "CHIPOTLE 2291", min: 11, max: 28 },
  { desc: "STARBUCKS STORE 08912", min: 4.5, max: 14 },
  { desc: "SWEETGREEN UNION SQ", min: 13, max: 24 },
  { desc: "DOORDASH*THAI BASIL", min: 22, max: 58 },
  { desc: "UBER *EATS", min: 18, max: 46 },
  { desc: "THE GOOD DINER", min: 28, max: 95 },
];
const SHOPPING: Merchant[] = [
  { desc: "AMAZON.COM*2K4LM8", min: 12, max: 140 },
  { desc: "TARGET 00012345", min: 18, max: 120 },
  { desc: "BEST BUY 00011", min: 25, max: 380 },
  { desc: "UNIQLO USA 1123", min: 30, max: 110 },
];
const TRANSPORT: Merchant[] = [
  { desc: "SHELL OIL 57444", min: 32, max: 68 },
  { desc: "CHEVRON 0091234", min: 30, max: 72 },
  { desc: "UBER *TRIP HELP.UBER.COM", min: 9, max: 42 },
  { desc: "LYFT *RIDE", min: 8, max: 36 },
];
const FUN: Merchant[] = [
  { desc: "AMC THEATRES 0412", min: 14, max: 42 },
  { desc: "STEAM GAMES", min: 5, max: 60 },
  { desc: "TICKETMASTER", min: 45, max: 220 },
];
const CARE: Merchant[] = [
  { desc: "CVS/PHARMACY #04512", min: 6, max: 48 },
  { desc: "GREAT CLIPS 1231", min: 22, max: 40 },
  { desc: "WALGREENS #1188", min: 5, max: 35 },
];

function spend(l: Ledger, account: string, merchants: Merchant[], perWeek: number, scale = 1): void {
  for (const ago of l.scatter(perWeek)) {
    const m = l.pick(merchants);
    l.add(account, ago, l.between(m.min, m.max) * scale, m.desc, l.rand() < 0.3 ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** Salaried renter: the "everything" profile. */
function alex(): Profile {
  const l = new Ledger("alex", 730);
  const PAY = 2_284.17;

  // Biweekly payroll into checking (a raise 9 months ago).
  for (const ago of l.every(14, 4)) l.add("chk", ago, -(ago < 270 ? PAY + 140 : PAY), "BLUEPEAK SOFTWARE PAYROLL DIRECT DEP");
  // Bills from checking.
  for (const ago of l.monthly(1)) l.add("chk", ago, 1_895, "MAPLE COURT APARTMENTS RENT ACH");
  for (const ago of l.monthly(12)) {
    const winter = [12, 1, 2].includes(l.calendarMonth(ago));
    l.add("chk", ago, l.between(winter ? 120 : 60, winter ? 165 : 95), "CITY POWER & LIGHT BILL PAY");
  }
  for (const ago of l.monthly(18)) l.add("chk", ago, 285.4, "NELNET STUDENT LOAN PMT");
  for (const ago of l.monthly(5)) l.transfer("chk", "sav", ago, 400, "ONLINE TRANSFER TO SAVINGS XXXX7702", "ONLINE TRANSFER FROM CHECKING XXXX7701");
  for (const ago of l.monthly(20)) l.add("sav", ago, 500, "VANGUARD BUYPAYMENT IRA CONTRIB");
  for (const ago of l.monthly(28)) l.add("sav", ago, -l.between(3.1, 6.4), "INTEREST PAYMENT");
  for (const ago of l.every(10, 6)) if (l.rand() < 0.55) l.add("chk", ago, l.pick([60, 80, 100, 200]), "ATM WITHDRAWAL 1234 MAIN ST");

  // Card: subscriptions (Netflix price change 4 months ago), everyday spending.
  for (const ago of l.monthly(9)) l.add("card", ago, ago < 120 ? 22.99 : 17.99, "NETFLIX.COM");
  for (const ago of l.monthly(14)) l.add("card", ago, 11.99, "SPOTIFY USA");
  for (const ago of l.monthly(3)) l.add("card", ago, 65, "VERIZON WIRELESS PAYMENT");
  for (const ago of l.monthly(22)) l.add("card", ago, 79.99, "COMCAST XFINITY INTERNET");
  for (const ago of l.monthly(2)) l.add("card", ago, 42, "EQUINOX FITNESS CLUB DUES");
  for (const ago of l.monthly(16)) if (l.calendarMonth(ago) === 3) l.add("card", ago, 139, "AMAZON PRIME MEMBERSHIP");
  // A subscription cancelled five months ago (stream goes stale) and one
  // started recently (early detection).
  for (const ago of l.monthly(13)) if (ago > 150) l.add("card", ago, 17.99, "HULU 877-8244858");
  for (const ago of l.monthly(19)) if (ago < 70) l.add("card", ago, 20, "OPENAI *CHATGPT SUBSCR");
  l.add("card", 33, 0, "CARD VERIFICATION AUTH");
  spend(l, "card", DINING, 2.6);
  spend(l, "card", FUN, 0.4);
  // Everyday spending on a second card at another bank.
  spend(l, "cash", GROCERIES, 1.6);
  spend(l, "cash", SHOPPING, 0.9);
  spend(l, "cash", TRANSPORT, 1.2);
  spend(l, "cash", CARE, 0.4);
  // A trip last month and one a year earlier (travel spike + year-over-year).
  for (const base of [32, 395]) {
    l.add("card", base + 40, 486.2, "DELTA AIR LINES");
    l.add("card", base + 2, 912.44, "MARRIOTT HOTELS LISBON");
    l.add("card", base + 1, 86.3, "RESTAURANTE O PATIO LISBOA");
    l.add("card", base, 64.1, "UBER *TRIP HELP.UBER.COM");
  }
  // Refunds and rewards on the card.
  l.add("card", 47, 129.99, "NORDSTROM #0412");
  l.add("card", 41, -129.99, "NORDSTROM #0412 RETURN CREDIT");
  l.add("cash", 200, 74.5, "AMAZON.COM*2K4LM8");
  l.add("cash", 193, -74.5, "AMAZON.COM REFUND");
  for (const ago of l.every(90, 25)) l.add("card", ago, -l.between(18, 45), "CASH BACK REWARD REDEMPTION");
  // Card autopay from checking, both legs (monthly statement-ish amounts).
  for (const ago of l.monthly(25)) {
    l.transfer("chk", "card", ago, l.between(650, 1_200), "CHASE CREDIT CRD AUTOPAY", "AUTOMATIC PAYMENT - THANK YOU", 2);
    l.transfer("chk", "cash", ago - 3, l.between(450, 800), "WF CREDIT CARD AUTO PAY", "ONLINE ACH PAYMENT THANK YOU", 1);
  }
  // People: friends paying back via Venmo, splitting via Zelle.
  for (const ago of l.every(23, 9)) l.add("chk", ago, -l.between(18, 75), "ZELLE PAYMENT FROM JAMIE LEE");
  for (const ago of l.every(41, 15)) l.add("chk", ago, l.between(25, 120), "ZELLE PAYMENT TO MORGAN DIAZ");
  // Yearly tax refund each spring.
  for (const ago of l.monthly(15)) if (l.calendarMonth(ago) === 4) l.add("chk", ago, -1_312, "IRS TREAS 310 TAX REF");
  // Cheques paid in, and one withdrawal from the brokerage.
  for (const ago of [64, 251, 530]) l.add("chk", ago, -l.between(75, 450), "MOBILE CHECK DEPOSIT");
  l.add("sav", 310, -3_000, "VANGUARD BROKERAGE WITHDRAWAL");

  return {
    username: "alex",
    name: "Alex Rivera",
    description: "salaried renter, 2 years, 3 banks: every flow class, budgets, rules",
    timeZone: "America/New_York",
    items: [
      {
        kind: "custom",
        institutionId: "ins_109508", // First Platypus Bank
        accounts: [
          l.account("chk", "depository", "checking", "Everyday Checking", "7701", 3_482.16),
          l.account("sav", "depository", "savings", "High-Yield Savings", "7702", 14_250.4),
          l.account("loan", "loan", "student", "Student Loan", "7703", 18_640.22),
          l.account("ira", "investment", "ira", "Roth IRA", "7704", 31_906.75),
        ],
      },
      {
        kind: "custom",
        institutionId: "ins_109511", // Tartan Bank
        accounts: [l.account("card", "credit", "credit card", "Sapphire Rewards Card", "4402", 1_386.9)],
      },
      {
        kind: "custom",
        institutionId: "ins_109512", // Houndstooth Bank
        accounts: [l.account("cash", "credit", "credit card", "Active Cash Card", "8803", 612.48)],
      },
    ],
    budgets: [
      { categoryKey: "FOOD_AND_DRINK", amount: 650, period: "monthly", startDaysAgo: 400 }, // usually over
      { categoryKey: "GENERAL_MERCHANDISE", amount: 400, period: "monthly", startDaysAgo: 400 }, // usually under
      { categoryKey: "ENTERTAINMENT", amount: 90, period: "monthly", startDaysAgo: 200 },
      { categoryKey: "TRANSPORTATION", amount: 60, period: "weekly", startDaysAgo: 120 },
      { categoryKey: "TRAVEL", amount: 2_500, period: "yearly", startDaysAgo: 300 },
      { categoryKey: SYNTHETIC_BUCKETS.cash_withdrawal, amount: 250, period: "monthly", startDaysAgo: 90 },
    ],
    spendingRules: [
      { merchant: "Whole Foods", spendingType: "necessary" },
      { merchant: "Starbucks", spendingType: "discretionary" },
      { merchant: "DoorDash", spendingType: "discretionary" },
    ],
    streamTypes: [
      { match: "MAPLE COURT", spendingType: "necessary" },
      { match: "CITY POWER", spendingType: "necessary" },
      { match: "NETFLIX", spendingType: "discretionary" },
      { match: "SPOTIFY", spendingType: "discretionary" },
    ],
    overrides: [
      { match: "EQUINOX", customName: "Gym membership" },
      { match: "BEST BUY", customCategory: "Electronics" },
    ],
  };
}

/** Freelancer: irregular income, no paycheck anchor, card carries a balance. */
function jordan(): Profile {
  const l = new Ledger("jordan", 365);
  const clients = ["STRIPE TRANSFER ST-8823 BRIGHTLINE STUDIO", "UPWORK ESCROW INC PAYMENT", "ACH DEPOSIT NORTHWIND LLC INVOICE"];
  for (const ago of l.scatter(0.9)) l.add("chk", ago, -l.between(450, 4_800), l.pick(clients));
  // PayPal balance cashed out to the bank (PayPal itself is not linked).
  for (const ago of l.every(33, 12)) l.add("chk", ago, -l.between(120, 900), "PAYPAL TRANSFER INST XFER");
  for (const ago of l.monthly(1)) l.add("chk", ago, 1_450, "SUNSET LOFTS LLC RENT");
  for (const ago of l.monthly(15)) if ([1, 4, 6, 9].includes(l.calendarMonth(ago))) l.add("chk", ago, l.between(1_800, 3_200), "IRS USATAXPYMT EST TAX");
  for (const ago of l.monthly(7)) l.add("chk", ago, 29.99, "ADOBE *CREATIVE CLOUD");
  for (const ago of l.monthly(19)) l.add("chk", ago, 15, "GITHUB INC");
  for (const ago of l.monthly(11)) l.add("chk", ago, 64.99, "T-MOBILE AUTOPAY");
  for (const ago of l.every(6, 2)) l.add("chk", ago, l.pick([40, 60, 100]), "ATM WITHDRAWAL 0042 MARKET ST");
  for (const ago of l.every(30, 8)) l.add("chk", ago, l.between(80, 260), "VENMO PAYMENT TO RILEY CHEN");
  // Card used for everything else; small irregular payments, no schedule.
  spend(l, "card", GROCERIES, 1.2);
  spend(l, "card", DINING, 2.4);
  spend(l, "card", SHOPPING, 1.1);
  spend(l, "card", TRANSPORT, 0.8);
  spend(l, "card", [{ desc: "WEWORK MEMBERSHIP", min: 45, max: 45 }, { desc: "B&H PHOTO VIDEO", min: 60, max: 900 }], 0.3);
  for (const ago of l.scatter(0.12)) l.transfer("chk", "card", ago, l.between(150, 600), "CAPITAL ONE ONLINE PMT", "ONLINE PAYMENT RECEIVED", 1);
  l.add("card", 30, 39.5, "LATE FEE");
  for (const ago of l.monthly(24)) l.add("card", ago, l.between(38, 61), "INTEREST CHARGE ON PURCHASES");

  return {
    username: "jordan",
    name: "Jordan Kim",
    description: "freelancer, 1 year: irregular income, est. taxes, card balance carried",
    timeZone: "America/Los_Angeles",
    items: [
      {
        kind: "custom",
        institutionId: "ins_109509", // First Gingham Credit Union
        accounts: [
          l.account("chk", "depository", "checking", "Business Checking", "3301", 6_912.8),
          l.account("card", "credit", "credit card", "Quicksilver Card", "3302", 4_877.35),
        ],
      },
    ],
    budgets: [
      { categoryKey: "FOOD_AND_DRINK", amount: 500, period: "monthly", startDaysAgo: 120 },
      { categoryKey: SYNTHETIC_BUCKETS.cash_withdrawal, amount: 100, period: "weekly", startDaysAgo: 60 },
      { categoryKey: SYNTHETIC_BUCKETS.p2p_payment, amount: 150, period: "monthly", startDaysAgo: 90 },
    ],
  };
}

/** Family homeowner: two salaries, loans, yearly bills, a broken connection. */
function taylor(): Profile {
  const l = new Ledger("taylor", 548);
  for (const ago of l.monthly(15)) l.add("joint", ago, -3_850, "GLOBEX CORP PAYROLL");
  for (const ago of l.monthly(28)) l.add("joint", ago, -3_850, "GLOBEX CORP PAYROLL");
  for (const ago of l.every(14, 9)) l.add("joint", ago, -1_642.5, "INITECH DIRECT DEP");
  for (const ago of l.monthly(1)) l.add("joint", ago, 2_412.66, "ROCKET MORTGAGE PAYMENT");
  for (const ago of l.monthly(10)) l.add("joint", ago, 389.12, "TOYOTA FINANCIAL AUTO PAYMENT");
  for (const ago of l.monthly(3)) l.add("joint", ago, 1_150, "BRIGHT HORIZONS CHILDCARE");
  for (const ago of l.monthly(20)) {
    const m = l.calendarMonth(ago);
    const peak = [1, 2, 7, 8].includes(m);
    l.add("joint", ago, l.between(peak ? 210 : 110, peak ? 290 : 160), "PG&E UTILITY PAYMENT");
    l.add("joint", ago, l.between(55, 85), "CITY WATER SEWER");
  }
  for (const ago of l.monthly(6)) if ([1, 7].includes(l.calendarMonth(ago))) l.add("joint", ago, 842, "STATE FARM INSURANCE PREMIUM");
  for (const ago of l.monthly(12)) if (l.calendarMonth(ago) === 9) l.add("joint", ago, 312, "DMV VEHICLE REGISTRATION");
  for (const ago of l.monthly(8)) if (l.calendarMonth(ago) === 2) l.add("joint", ago, 4_850, "COUNTY PROPERTY TAX");
  // Money to the couple's own savings at another (unlinked) bank, and back.
  for (const ago of l.monthly(16)) l.add("joint", ago, 750, "TRANSFER TO TAYLOR MORGAN ALLY SAVINGS");
  l.add("joint", 220, -2_000, "TRANSFER FROM TAYLOR MORGAN ALLY SAVINGS");
  l.add("joint", 140, -1_200, "FIDELITY 529 DISTRIBUTION");
  for (const ago of l.monthly(26)) l.add("joint", ago, 300, "FIDELITY 529 COLLEGE CONTRIB");
  spend(l, "card1", GROCERIES, 2.2, 1.4);
  spend(l, "card1", DINING, 1.6);
  spend(l, "card1", [...SHOPPING, { desc: "BUY BUY BABY #312", min: 25, max: 180 }], 1.4);
  spend(l, "card2", TRANSPORT, 1.8);
  spend(l, "card2", [{ desc: "HOME DEPOT 4521", min: 15, max: 450 }, { desc: "LOWES #01123", min: 20, max: 300 }], 0.5);
  spend(l, "card2", [{ desc: "KAISER PERMANENTE COPAY", min: 25, max: 60 }, { desc: "SMILE DENTAL GROUP", min: 80, max: 240 }], 0.25);
  for (const ago of l.monthly(23)) {
    l.transfer("joint", "card1", ago, l.between(1_400, 2_300), "CITI AUTOPAY PAYMENT", "AUTOPAY PAYMENT THANK YOU", 1);
    l.transfer("joint", "card2", ago - 2, l.between(250, 700), "AMEX EPAYMENT ACH PMT", "ONLINE PAYMENT - THANK YOU", 1);
  }

  return {
    username: "taylor",
    name: "Taylor Morgan",
    description: "family homeowner, 18 months, 3 banks: loans, yearly bills, reconnect needed",
    timeZone: "America/Chicago",
    items: [
      {
        kind: "custom",
        institutionId: "ins_109510", // Tattersall Federal Credit Union
        accounts: [
          l.account("joint", "depository", "checking", "Joint Checking", "5501", 8_204.33),
          l.account("mortgage", "loan", "mortgage", "Home Mortgage", "5502", 341_220.0),
          l.account("auto", "loan", "auto", "Auto Loan", "5503", 14_380.5),
        ],
      },
      {
        kind: "custom",
        institutionId: "ins_109512", // Houndstooth Bank
        accounts: [l.account("card1", "credit", "credit card", "Costco Citi Card", "6601", 2_118.4)],
      },
      {
        kind: "custom",
        institutionId: "ins_109509", // First Gingham Credit Union
        loginRequired: true,
        accounts: [l.account("card2", "credit", "credit card", "Blue Cash Card", "6602", 640.15)],
      },
    ],
    budgets: [
      { categoryKey: "FOOD_AND_DRINK", amount: 300, period: "weekly", startDaysAgo: 180 },
      { categoryKey: "HOME_IMPROVEMENT", amount: 3_000, period: "yearly", startDaysAgo: 300 },
      { categoryKey: "RENT_AND_UTILITIES", amount: 450, period: "monthly", startDaysAgo: 240 },
    ],
    streamTypes: [{ match: "BRIGHT HORIZONS", spendingType: "necessary" }],
  };
}

/** Student: ten weeks of history, weekly pay, money from parents. */
function sam(): Profile {
  const l = new Ledger("sam", 70);
  for (const ago of l.every(7, 3)) l.add("chk", ago, -l.between(142, 198), "CAMPUS BOOKSTORE PAYROLL");
  for (const ago of l.monthly(2)) l.add("chk", ago, -300, "ZELLE FROM PAT RIVERA");
  for (const ago of l.monthly(4)) l.add("chk", ago, 650, "COLLEGETOWN HOUSING RENT");
  for (const ago of l.monthly(10)) l.add("chk", ago, 5.99, "SPOTIFY USA STUDENT");
  spend(l, "chk", DINING, 3, 0.7);
  spend(l, "chk", GROCERIES, 0.8, 0.5);
  spend(l, "card", [{ desc: "CAMPUS BOOKSTORE", min: 20, max: 140 }, ...SHOPPING], 0.8, 0.6);
  for (const ago of l.monthly(21)) l.transfer("chk", "card", ago, l.between(40, 120), "DISCOVER E-PAYMENT", "INTERNET PAYMENT - THANK YOU", 1);
  l.add("chk", 12, 35, "OVERDRAFT FEE");

  return {
    username: "sammy",
    name: "Sam Patel",
    description: "student, 10 weeks: weekly pay, money from parents, thin balances",
    items: [
      {
        kind: "custom",
        institutionId: "ins_109511", // Tartan Bank
        accounts: [
          l.account("chk", "depository", "checking", "Student Checking", "9901", 41.27),
          l.account("card", "credit", "credit card", "Student Card", "9902", 212.5),
        ],
      },
    ],
  };
}

export function buildProfiles(): Profile[] {
  return [
    alex(),
    jordan(),
    taylor(),
    sam(),
    {
      username: "newbie",
      name: "Nia Newbie",
      description: "signed up, nothing linked (empty states)",
      items: [],
    },
    {
      username: "dynamic",
      name: "Dana Dynamic",
      description: "Plaid user_transactions_dynamic: new transactions on each refresh",
      items: [{ kind: "persona", institutionId: "ins_109508", plaidUser: "user_transactions_dynamic" }],
    },
  ];
}
