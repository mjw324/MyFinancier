/**
 * Flow classification rules — assigns every transaction exactly one
 * FlowClass (see ./flow.ts for the taxonomy and what each class means for
 * totals).
 *
 * Pure: no database, no I/O, no clock. Everything the rules need arrives in
 * the arguments. The rules are generic — they reason about account types,
 * Plaid categories, description wording, the user's own linked accounts and
 * institutions, and the user's own name. Nothing here knows about a specific
 * user, bank or person.
 *
 * Precedence (first match wins):
 *   1. zero amount                        → zero
 *   2. manual override                    → the user's class (beats a pair)
 *   3. validated transfer pair            → cc_payment / internal_transfer
 *   4. credit / loan accounts             → rewards, payments, refunds, spending
 *   5. depository (and other) outflows    → card payments, loans, cash, payment
 *                                           apps, own-name, investments, people
 *   6. depository (and other) inflows     → income, rewards, savings, deposits,
 *                                           payment apps, people, refunds
 *
 * Internal classes need both legs inside the data. A validated pair proves
 * that. Without a pair, a description naming a linked account only counts as
 * internal while that account's data has not caught up yet ("in flight");
 * once the other account's history covers the date and no counterpart
 * exists, the money left (or arrived from) somewhere this app cannot see:
 * debt service, or a move to/from the user's unlinked account. This keeps
 * money in − money out − saved equal to the change in balances.
 */

import { isFlowClass, type FlowClass } from "./flow";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface FlowPairPartner {
  accountId: string;
  amount: string | number;
  /** Plaid account type of the partner row's account. */
  accountType: string;
}

export interface FlowTxn {
  amount: string | number;
  /** Transaction date (a UTC-midnight Date or a YYYY-MM-DD string). */
  date?: Date | string | null;
  name: string | null;
  merchantName?: string | null;
  /** Plaid personal_finance_category.primary, e.g. "FOOD_AND_DRINK". */
  category?: string | null;
  /** Plaid personal_finance_category.detailed. */
  categoryId?: string | null;
  /** The user's category. Replaces Plaid's category as rule input. */
  customCategory?: string | null;
  flowClass?: string | null;
  flowClassSource?: string | null;
  accountId?: string;
  /**
   * The other leg of this row's transfer pair, resolved by the caller. Only
   * trusted after validation (different account, opposite sign, same size);
   * a dangling or mismatched pair is ignored.
   */
  pairPartner?: FlowPairPartner | null;
}

export interface FlowAccount {
  id: string;
  /** Plaid account type: depository | credit | loan | investment | other. */
  type: string;
  subtype?: string | null;
  name?: string | null;
  officialName?: string | null;
  institutionName?: string | null;
  /**
   * First and last posted transaction dates on this account (its history
   * window). `null` means the account has no posted history; leaving both
   * undefined means "unknown" and the account is treated as covering every
   * date.
   */
  historyStart?: Date | string | null;
  historyEnd?: Date | string | null;
}

export interface ClassifyContext {
  /** Every account the user has linked (any status), with institution names. */
  accounts: FlowAccount[];
  /** The user's own name (Better Auth user.name). */
  userName?: string | null;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Legs of one transfer are dated at most this many days apart. */
export const PAIR_WINDOW_DAYS = 5;
/** Days after an account's last posted row that it still counts as covering a date. */
const COVERAGE_GRACE_DAYS = 10;

const CC_PAYMENT_DETAILED = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const INVESTMENT_OUT = "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS";
const INVESTMENT_IN = "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS";
const WITHDRAWAL = "TRANSFER_OUT_WITHDRAWAL";
const DEPOSIT = "TRANSFER_IN_DEPOSIT";
const FROM_APPS_IN = "TRANSFER_IN_TRANSFER_IN_FROM_APPS";

/** Plaid primaries for purchases of goods and services. */
export const MERCHANT_PRIMARIES = new Set([
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "RENT_AND_UTILITIES",
  "TRANSPORTATION",
  "TRAVEL",
]);

/** Every Plaid PFC primary. Anything else in custom_category is a user label. */
const PLAID_PRIMARIES = new Set([
  ...MERCHANT_PRIMARIES,
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "LOAN_DISBURSEMENTS",
  "OTHER",
]);

/** INCOME detailed categories that mean earned income even inside a payment app. */
const EARNED_INCOME_DETAILED = new Set([
  "INCOME_WAGES", // v1; split into the three below in v2
  "INCOME_SALARY",
  "INCOME_CONTRACTOR",
  "INCOME_GIG_ECONOMY",
  "INCOME_DIVIDENDS",
  "INCOME_INTEREST_EARNED",
  "INCOME_RETIREMENT_PENSION",
  "INCOME_TAX_REFUND",
  "INCOME_UNEMPLOYMENT",
  "INCOME_MILITARY",
  "INCOME_LONG_TERM_DISABILITY",
]);

/** Payment apps: an account at one of these is a wallet, not a bank. */
const PAYMENT_APPS: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: "venmo", pattern: /\bvenmo\b/ },
  { key: "paypal", pattern: /\bpay\s?pal\b/ },
  { key: "cashapp", pattern: /\b(?:cash\s?app|square\s+cash)\b/ },
  { key: "applecash", pattern: /\bapple\s+cash\b/ },
];

/** Brokerages and robo-advisors. Money moved there is saved, not spent. */
const KNOWN_BROKERAGES =
  /\b(?:robinhood|vanguard|fidelity|schwab|e\s?trade|etrade|betterment|wealthfront|acorns|stash|webull|coinbase|merrill|ameritrade|m1\s+finance)\b/;

/** Issuer rewards credited to a card or paid out to a bank account. */
const REWARD_TEXT =
  /\b(?:cash\s?back|cashback|rewards?|points?\s+redeem\w*|redemption|redeemed|statement\s+credit|pay\s?yourself\s?back|payyourselfback)\b/;

/** Wording a card issuer uses for a payment posted to the card. */
const CARD_INFLOW_PAYMENT_TEXT =
  /(?:^|[^a-z])(?:e-?)?(?:payment|paymnt|pymt|pmt|autopay|auto-?pay|auto-?pmt|directpay|thank\s?you|transfer)(?:$|[^a-z])/;

/** Wording on a bank debit that pays a card or a lender. */
const PAYMENT_OUT_TEXT =
  /(?:^|[^a-z])(?:e-?)?(?:payment|paymnt|pymt|pmt|autopay|auto-?pay|auto-?pmt|directpay|crcardpmt|cardpmt|epay)(?:$|[^a-z])/;

/** Payment-app cash-out to a bank account. */
const CASHOUT_TEXT =
  /\b(?:standard\s+transfer|instant\s+transfer|transfer\s+to\s+(?:your\s+)?bank|bank\s+transfer|cash\s?out|withdrawal\s+to)\b/;

/** Payment-app top-up from a bank account. */
const CASHIN_TEXT =
  /\b(?:transfer\s+from\s+(?:your\s+)?bank|add(?:ed)?\s+money|add\s+funds|bank\s+deposit|top[\s-]?up)\b/;

/** Wording of an employer paying wages, whatever category Plaid guessed. */
const PAYROLL_TEXT = /\b(?:payroll|salary|direct\s+dep(?:osit)?|dir\s+dep)\b/;

/** A deposited cheque or cash at a bank. */
const DEPOSIT_TEXT = /\bdeposit\b/;

/** A person-to-person payment: Zelle wording, or a payment-app `Name "note"` row. */
const ZELLE_TEXT = /\bzelle\b/;
const QUOTED_NOTE = /^[^"“”]{2,60}["“]/;

/** Words that carry no identity in institution and account names. */
const STOP_TOKENS = new Set([
  "the", "inc", "llc", "and", "of", "co", "corp", "company", "group", "na",
  "bank", "banking", "online", "national", "association", "federal", "union",
  "financial", "services", "trust", "savings", "checking", "account", "accounts",
  "card", "cards", "credit", "debit", "total", "custom", "cash", "personal",
  "profile", "individual", "joint", "rewards", "reward", "preferred", "unlimited",
  "plus", "premier", "advantage", "everyday", "signature", "platinum", "gold",
  "silver", "business", "student", "mastercard", "visa", "amex", "world",
  "elite", "premium", "select", "secured", "it", "my", "brokerage",
  "roth", "ira", "invest", "investing", "investment", "investments", "securities",
  "retirement", "money", "market",
  "high", "yield", "spending", "share", "draft", "loan", "mortgage", "auto",
]);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[®™©]/g, " ")
    .replace(/[^a-z0-9&\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return s.length ? s.split(" ") : [];
}

/**
 * The identifying tokens of an institution or account name, in order, e.g.
 * "Example Bank - Personal" → ["example"], "Northwind One" → ["northwind",
 * "one"], "Contoso Custom Cash® Card" → ["contoso"]. Digits and masks are
 * dropped.
 */
export function brandTokens(name: string | null | undefined): string[] {
  return words(normalizeText(name)).filter(
    (t) => t.length >= 2 && !STOP_TOKENS.has(t) && !/\d/.test(t),
  );
}

/**
 * Whole-word match of a brand phrase in a description. A single-token brand
 * also matches a description word that abbreviates it (≥4 letters, e.g. the
 * institution "Contosobank" matches "CONTOSO AUTOPAY"), but never the other
 * way round, so a short brand never matches a longer unrelated word
 * (review S5: a short brand must never match a longer word that merely
 * contains it).
 */
export function mentionsBrand(descWords: string[], brand: string[]): boolean {
  if (brand.length === 0) return false;
  if (brand.length === 1) {
    const tok = brand[0];
    if (tok.length < 3) return false;
    return descWords.some(
      (w) => w === tok || (w.length >= 4 && tok.length >= 5 && tok.startsWith(w)),
    );
  }
  for (let i = 0; i + brand.length <= descWords.length; i++) {
    let ok = true;
    for (let j = 0; j < brand.length; j++) {
      if (descWords[i + j] !== brand[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function paymentAppKey(text: string): string | null {
  for (const app of PAYMENT_APPS) if (app.pattern.test(text)) return app.key;
  return null;
}

export function toDayNumber(d: Date | string | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  const t =
    typeof d === "string" ? Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d) : d.getTime();
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : null;
}

function toAmount(v: string | number): number {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toCents(v: string | number): number {
  return Math.round(toAmount(v) * 100);
}

// ---------------------------------------------------------------------------
// Prepared context (memoised per context object)
// ---------------------------------------------------------------------------

interface PreparedAccount {
  account: FlowAccount;
  isLiability: boolean;
  isInvestment: boolean;
  /** A bank (cash account that is not a payment-app wallet). */
  isBank: boolean;
  appKey: string | null;
  /** Brand phrases this account may be named by in another account's description. */
  brands: string[][];
  institutionBrand: string[];
  /** History window known? (false = treat as covering every date) */
  windowKnown: boolean;
  start: number | null;
  end: number | null;
}

interface PreparedContext {
  accounts: PreparedAccount[];
  byId: Map<string, PreparedAccount>;
  /** Brand phrases of institutions that hold investment accounts. */
  brokerageBrands: string[][];
  userNameParts: string[];
}

const prepared = new WeakMap<ClassifyContext, PreparedContext>();

function prepare(ctx: ClassifyContext): PreparedContext {
  const cached = prepared.get(ctx);
  if (cached) return cached;
  const accounts: PreparedAccount[] = ctx.accounts.map((a) => {
    const isInvestment = a.type === "investment" || a.type === "brokerage";
    const isLiability = a.type === "credit" || a.type === "loan";
    const institutionBrand = brandTokens(a.institutionName);
    const brands: string[][] = [];
    if (institutionBrand.length) brands.push(institutionBrand);
    // Account names identify cards ("Contoso Custom Cash" → contoso), but an
    // investment account's name is never evidence of anything (review S5).
    if (!isInvestment) {
      for (const n of [a.name, a.officialName]) {
        const b = brandTokens(n);
        if (b.length && !brands.some((x) => x.join(" ") === b.join(" "))) brands.push(b);
      }
    }
    const cashAccount = a.type === "depository" || a.type === "other";
    const appKey = cashAccount
      ? paymentAppKey(normalizeText(`${a.institutionName ?? ""} ${a.name ?? ""}`))
      : null;
    return {
      account: a,
      isLiability,
      isInvestment,
      isBank: cashAccount && appKey === null,
      appKey,
      brands,
      institutionBrand,
      windowKnown: a.historyStart !== undefined || a.historyEnd !== undefined,
      start: toDayNumber(a.historyStart),
      end: toDayNumber(a.historyEnd),
    };
  });
  const brokerageBrands: string[][] = [];
  for (const p of accounts) {
    if (p.isInvestment && p.institutionBrand.length) brokerageBrands.push(p.institutionBrand);
  }
  const nameParts = words(normalizeText(ctx.userName)).filter(
    (p) => p.length >= 3 && /^[a-z]+$/.test(p),
  );
  const out: PreparedContext = {
    accounts,
    byId: new Map(accounts.map((p) => [p.account.id, p])),
    brokerageBrands,
    // A single-token "name" is usually a username; only trust it if it is long.
    userNameParts: nameParts.length === 1 && nameParts[0].length < 5 ? [] : nameParts,
  };
  prepared.set(ctx, out);
  return out;
}

/** The account's feed covers this date (it would contain a counterpart). */
function present(p: PreparedAccount, day: number | null): boolean {
  if (!p.windowKnown) return true;
  if (p.start === null || p.end === null) return false;
  if (day === null) return true;
  return day >= p.start && day <= p.end + COVERAGE_GRACE_DAYS;
}

/**
 * The account's feed may not contain the counterpart *yet*: the date is
 * inside its history but within the pairing window of its newest row (or
 * past it). An unpaired row naming such an account is still in flight.
 */
function inFlight(p: PreparedAccount, day: number | null): boolean {
  if (!p.windowKnown) return true;
  if (p.start === null || p.end === null) return false;
  if (day === null) return true;
  return day >= p.start && day > p.end - PAIR_WINDOW_DAYS;
}

function namesAny(descWords: string[], p: PreparedAccount): boolean {
  return p.brands.some((b) => mentionsBrand(descWords, b));
}

// ---------------------------------------------------------------------------
// Shared predicates (also used by transfer pairing)
// ---------------------------------------------------------------------------

export interface RowFacts {
  amount: number;
  cents: number;
  inflow: boolean;
  outflow: boolean;
  primary: string;
  detailed: string;
  /** customCategory set to something that is not a Plaid primary. */
  customLabel: boolean;
  text: string;
  descWords: string[];
  day: number | null;
}

/** Normalises a row: the user's custom category replaces Plaid's as rule input. */
export function rowFacts(txn: FlowTxn): RowFacts {
  const amount = toAmount(txn.amount);
  const plaidPrimary = txn.category ?? "";
  const plaidDetailed = txn.categoryId ?? "";
  let primary = plaidPrimary;
  let detailed = plaidDetailed;
  let customLabel = false;
  const custom = txn.customCategory?.trim();
  if (custom) {
    primary = custom;
    if (PLAID_PRIMARIES.has(custom)) {
      if (!plaidDetailed.startsWith(`${custom}_`)) detailed = "";
    } else {
      // A user label ("GIFTS", "RENT") is a spending category for rule purposes.
      customLabel = true;
      detailed = "";
    }
  }
  const text = normalizeText(`${txn.name ?? ""} ${txn.merchantName ?? ""}`);
  return {
    amount,
    cents: Math.round(amount * 100),
    inflow: amount < 0,
    outflow: amount > 0,
    primary,
    detailed,
    customLabel,
    text,
    descWords: words(text),
    day: toDayNumber(txn.date),
  };
}

function isMerchantPrimary(f: RowFacts): boolean {
  return f.customLabel || MERCHANT_PRIMARIES.has(f.primary);
}

/** Payment to or from a person rather than between the user's own accounts. */
export function looksLikePersonPayment(txn: FlowTxn, f: RowFacts = rowFacts(txn)): boolean {
  if (ZELLE_TEXT.test(f.text)) return true;
  return QUOTED_NOTE.test((txn.name ?? "").trim());
}

export function namesUser(f: RowFacts, ctx: ClassifyContext): boolean {
  const parts = prepare(ctx).userNameParts;
  if (parts.length === 0) return false;
  return parts.every((p) => f.descWords.includes(p));
}

export function isPaymentAppAccount(account: FlowAccount, ctx: ClassifyContext): boolean {
  const p = prepare(ctx).byId.get(account.id);
  if (p) return p.appKey !== null;
  if (account.type !== "depository" && account.type !== "other") return false;
  return (
    paymentAppKey(normalizeText(`${account.institutionName ?? ""} ${account.name ?? ""}`)) !== null
  );
}

/**
 * Evidence that a row is one leg of a movement between the user's own
 * accounts. Transfer pairing requires it on at least one leg, so two
 * ordinary rows that merely share an amount (a purchase and an unrelated
 * receipt) can never be paired.
 */
export function hasTransferEvidence(
  txn: FlowTxn,
  account: FlowAccount,
  ctx: ClassifyContext,
): boolean {
  const f = rowFacts(txn);
  if (f.amount === 0) return false;
  const liability = account.type === "credit" || account.type === "loan";
  if (liability && f.inflow) {
    if (REWARD_TEXT.test(f.text)) return false;
    if (CARD_INFLOW_PAYMENT_TEXT.test(f.text)) return true;
    return (
      f.detailed === CC_PAYMENT_DETAILED ||
      f.primary === "LOAN_PAYMENTS" ||
      f.primary === "LOAN_DISBURSEMENTS" ||
      f.primary === "TRANSFER_IN"
    );
  }
  if (isMerchantPrimary(f)) return false;
  if (f.detailed === WITHDRAWAL || f.detailed === DEPOSIT) return false;
  if (isPaymentAppAccount(account, ctx)) {
    if (f.outflow && CASHOUT_TEXT.test(f.text)) return true;
    if (f.inflow && CASHIN_TEXT.test(f.text)) return true;
  }
  return ["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "LOAN_DISBURSEMENTS"].includes(
    f.primary,
  );
}

/**
 * Rows that can never be a leg of an own-account transfer pair: pending
 * (unless `allowPending`), zero, user-classified, payments to/from other
 * people, cash at an ATM, rewards, and purchases/refunds/income without
 * transfer wording.
 */
export function isPairable(
  txn: FlowTxn & { pending?: boolean | null },
  account: FlowAccount,
  ctx: ClassifyContext,
  options: { allowPending?: boolean } = {},
): boolean {
  if (txn.pending && !options.allowPending) return false;
  if (txn.flowClassSource === "manual") return false;
  const f = rowFacts(txn);
  if (f.amount === 0) return false;
  if (account.type === "investment") return false;
  if (f.detailed === WITHDRAWAL || f.detailed === DEPOSIT) return false;
  if (f.inflow && REWARD_TEXT.test(f.text)) return false;
  if (looksLikePersonPayment(txn, f) && !namesUser(f, ctx)) return false;
  if ((isMerchantPrimary(f) || f.primary === "INCOME") && !hasTransferEvidence(txn, account, ctx)) {
    return false;
  }
  return true;
}

/** Does this row's description name the given account / institution / app? */
export function namesAccount(txn: FlowTxn, account: FlowAccount, ctx: ClassifyContext): boolean {
  const p = prepare(ctx).byId.get(account.id);
  if (!p) return false;
  const f = rowFacts(txn);
  if (namesAny(f.descWords, p)) return true;
  return p.appKey !== null && paymentAppKey(f.text) === p.appKey;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function validPartner(txn: FlowTxn, f: RowFacts): FlowPairPartner | null {
  const partner = txn.pairPartner;
  if (!partner) return null;
  if (txn.accountId && partner.accountId === txn.accountId) return null;
  const pc = toCents(partner.amount);
  if (pc === 0 || Math.sign(pc) === Math.sign(f.cents) || Math.abs(pc) !== Math.abs(f.cents)) {
    return null;
  }
  return partner;
}

/** Assigns exactly one flow class. See the file header for the precedence. */
export function classifyFlow(
  txn: FlowTxn,
  account: FlowAccount,
  context: ClassifyContext,
): FlowClass {
  const f = rowFacts(txn);

  // 1. Zero-amount rows carry no money.
  if (f.cents === 0) return "zero";

  // 2. A user's decision always wins — including over a transfer pair, so a
  //    false pair can be corrected (review S2).
  if (txn.flowClassSource === "manual" && isFlowClass(txn.flowClass)) {
    return txn.flowClass;
  }

  // 3. A validated pair: both legs are inside the linked perimeter.
  const partner = validPartner(txn, f);
  if (partner) {
    const liability = account.type === "credit" || account.type === "loan";
    const partnerLiability = partner.accountType === "credit" || partner.accountType === "loan";
    return liability || partnerLiability ? "cc_payment" : "internal_transfer";
  }

  const ctx = prepare(context);
  const self: PreparedAccount =
    ctx.byId.get(account.id) ?? prepare({ accounts: [account] }).byId.get(account.id)!;

  if (self.isLiability) return classifyLiability(txn, f, ctx, self);
  return f.outflow
    ? classifyOutflow(txn, f, context, ctx, self)
    : classifyInflow(txn, f, context, ctx, self);
}

function anyBankInFlight(f: RowFacts, ctx: PreparedContext, self: PreparedAccount): boolean {
  return ctx.accounts.some((p) => p.isBank && p !== self && inFlight(p, f.day));
}

function classifyLiability(
  txn: FlowTxn,
  f: RowFacts,
  ctx: PreparedContext,
  self: PreparedAccount,
): FlowClass {
  if (f.inflow) {
    // Rewards first: "points redeemed", "statement credit" and "cash back"
    // must not be swallowed by the payment wording below (review S3).
    if (REWARD_TEXT.test(f.text)) return "card_reward";
    const payment =
      CARD_INFLOW_PAYMENT_TEXT.test(f.text) ||
      f.detailed === CC_PAYMENT_DETAILED ||
      f.primary === "LOAN_PAYMENTS" ||
      f.primary === "LOAN_DISBURSEMENTS" ||
      self.account.type === "loan";
    if (payment) {
      // Unpaired: internal only while a linked bank's data has not caught up;
      // otherwise the payment came from an account this app cannot see.
      return anyBankInFlight(f, ctx, self) ? "cc_payment" : "external_transfer_in";
    }
    // A credit on a card that is not a payment or a reward is money coming
    // back from a merchant — including ones Plaid labels INCOME (review S4)
    // or TRANSFER_IN without payment wording.
    return "refund";
  }
  // Outflows on a card are purchases, except cash advances, loan payments and
  // payments to people made with the card.
  if (f.detailed === WITHDRAWAL) return "cash_withdrawal";
  if (f.primary === "LOAN_PAYMENTS") return "debt_payment";
  if (
    f.primary === "TRANSFER_OUT" &&
    (looksLikePersonPayment(txn, f) || paymentAppKey(f.text) !== null)
  ) {
    return "p2p_payment";
  }
  return "spending";
}

/** A linked card/loan named in the description, still in flight at this date. */
function namedLiabilityInFlight(f: RowFacts, ctx: PreparedContext): boolean {
  return ctx.accounts.some((p) => p.isLiability && namesAny(f.descWords, p) && inFlight(p, f.day));
}

/** Linked banks (not wallets, not the row's own institution) named in the description. */
function namedBanks(f: RowFacts, ctx: PreparedContext, self: PreparedAccount): PreparedAccount[] {
  const own = self.institutionBrand.join(" ");
  return ctx.accounts.filter(
    (p) =>
      p.isBank &&
      p !== self &&
      // A description naming the row's own institution is not evidence of a
      // second account ("<Bank> QuickPay" is a payment service).
      (own === "" || p.institutionBrand.join(" ") !== own) &&
      namesAny(f.descWords, p),
  );
}

/** A linked wallet for the app named in the description whose feed covers the date. */
function linkedAppPresent(appKey: string, f: RowFacts, ctx: PreparedContext, self: PreparedAccount): boolean {
  return ctx.accounts.some((p) => p.appKey === appKey && p !== self && present(p, f.day));
}

function namesBrokerage(f: RowFacts, ctx: PreparedContext): boolean {
  if (KNOWN_BROKERAGES.test(f.text)) return true;
  return ctx.brokerageBrands.some((b) => mentionsBrand(f.descWords, b));
}

/** "Standard transfer To Example State Bank Checking (…1234)" → the destination's words. */
function namedDestination(text: string): string[] | null {
  const m = text.match(/\btransfer\s+to\s+(.+)$/);
  if (!m) return null;
  const dest = words(m[1]).filter((w) => !STOP_TOKENS.has(w) && !/\d/.test(w));
  return dest.length ? dest : null;
}

/** Own-account movement without a pair: internal while in flight, else moved outside. */
function ownMovement(
  outflow: boolean,
  candidates: PreparedAccount[],
  f: RowFacts,
): FlowClass {
  if (candidates.some((p) => inFlight(p, f.day))) return "internal_transfer";
  return outflow ? "external_transfer_out" : "external_transfer_in";
}

function classifyOutflow(
  txn: FlowTxn,
  f: RowFacts,
  context: ClassifyContext,
  ctx: PreparedContext,
  self: PreparedAccount,
): FlowClass {
  const isApp = self.appKey !== null;

  // Paying a card or a lender. Paired payments were handled above; an
  // unpaired one is internal only while the named card's data is in flight.
  // A card that is not linked — or whose history shows no matching credit —
  // is debt service: those purchases are invisible here (review S5).
  const paymentShaped =
    f.detailed === CC_PAYMENT_DETAILED ||
    (["LOAN_PAYMENTS", "TRANSFER_OUT", "OTHER", ""].includes(f.primary) &&
      PAYMENT_OUT_TEXT.test(f.text));
  if (paymentShaped) {
    if (namedLiabilityInFlight(f, ctx)) return "cc_payment";
    if (f.detailed === CC_PAYMENT_DETAILED || f.primary === "LOAN_PAYMENTS") return "debt_payment";
  }
  if (f.primary === "LOAN_PAYMENTS") return "debt_payment";
  if (f.detailed === WITHDRAWAL) return "cash_withdrawal";

  // Payment-app wallet: cash-outs to a bank, and payments to people.
  if (isApp) {
    if (CASHOUT_TEXT.test(f.text)) {
      const dest = namedDestination(f.text);
      const banks = ctx.accounts.filter((p) => p.isBank && p !== self);
      if (dest) {
        const named = banks.filter((p) => p.brands.some((b) => b.every((tok) => dest.includes(tok))));
        return named.length ? ownMovement(true, named, f) : "external_transfer_out";
      }
      // Destination not named: it is the user's own bank either way (review S8).
      return ownMovement(true, banks, f);
    }
    if (looksLikePersonPayment(txn, f)) return "p2p_payment";
  }

  if (f.primary === "TRANSFER_OUT" || f.primary === "OTHER" || f.primary === "") {
    const transferish = f.primary === "TRANSFER_OUT";
    if (looksLikePersonPayment(txn, f)) {
      // Zelle to oneself at another bank is an own-account move.
      if (namesUser(f, context)) return ownMovement(true, namedBanks(f, ctx, self), f);
      return transferish || isApp ? "p2p_payment" : "spending";
    }
    if (transferish) {
      // The user moving money to an account of their own.
      if (namesUser(f, context)) return ownMovement(true, namedBanks(f, ctx, self), f);
      // A bank debit funding a linked wallet: the wallet's own feed records
      // what the money was spent on, so this leg is internal.
      const app = isApp ? null : paymentAppKey(f.text);
      if (app && linkedAppPresent(app, f, ctx, self)) return "internal_transfer";
      // Investments: saved, not spent. A card payment Plaid mislabels as an
      // investment transfer is caught by pairing with the card's credit.
      if (f.detailed === INVESTMENT_OUT) return "savings_out";
      if (namesBrokerage(f, ctx)) return "savings_out";
      // A transfer naming another of the user's linked banks.
      const banks = namedBanks(f, ctx, self);
      if (banks.length) return ownMovement(true, banks, f);
      return "p2p_payment";
    }
  }

  return "spending";
}

function classifyInflow(
  txn: FlowTxn,
  f: RowFacts,
  context: ClassifyContext,
  ctx: PreparedContext,
  self: PreparedAccount,
): FlowClass {
  const isApp = self.appKey !== null;
  const customIncome = Boolean(txn.customCategory) && f.primary === "INCOME";

  // Payment-app wallet: money from people is a reimbursement (product
  // decision 1), unless it is clearly earned income or the user says so.
  if (isApp) {
    if (customIncome) return "income";
    if (f.primary === "INCOME" && EARNED_INCOME_DETAILED.has(f.detailed)) return "income";
    if (CASHIN_TEXT.test(f.text)) {
      return ownMovement(false, ctx.accounts.filter((p) => p.isBank && p !== self), f);
    }
    if (looksLikePersonPayment(txn, f) || f.primary === "INCOME") return "reimbursement";
  }

  // Issuer rewards paid out to a bank account.
  if (REWARD_TEXT.test(f.text) && ["INCOME", "OTHER", "TRANSFER_IN", ""].includes(f.primary)) {
    return "card_reward";
  }

  if (f.primary === "INCOME") return "income";
  // Wages Plaid filed under a purchase or "other" category.
  if (!isApp && PAYROLL_TEXT.test(f.text) && f.primary !== "TRANSFER_IN") return "income";

  // A card payment coming back (returned payment / credit-balance refund).
  if (PAYMENT_OUT_TEXT.test(f.text) && !isMerchantPrimary(f) && !isApp) {
    if (namedLiabilityInFlight(f, ctx)) return "cc_payment";
    if (ctx.accounts.some((p) => p.isLiability && namesAny(f.descWords, p))) return "other_inflow";
  }

  // Money back out of investments: dis-saving, not income (review S6).
  if (f.detailed === INVESTMENT_IN) return "savings_in";
  if ((f.primary === "TRANSFER_IN" || f.primary === "OTHER") && namesBrokerage(f, ctx)) {
    return "savings_in";
  }

  // Cash or a cheque paid in at a bank: the source is unknown.
  if (f.detailed === DEPOSIT) return "other_inflow";
  if (!isApp && (f.primary === "TRANSFER_IN" || f.primary === "OTHER") && DEPOSIT_TEXT.test(f.text)) {
    return "other_inflow";
  }

  // A wallet cash-out arriving at the bank: internal when the wallet is
  // linked (its feed holds the other leg); from an unlinked wallet it is
  // money people sent the user.
  const app = isApp ? null : paymentAppKey(f.text);
  if (app && !isMerchantPrimary(f)) {
    return linkedAppPresent(app, f, ctx, self) ? "internal_transfer" : "reimbursement";
  }

  if (looksLikePersonPayment(txn, f)) {
    if (namesUser(f, context)) return ownMovement(false, namedBanks(f, ctx, self), f);
    return "reimbursement";
  }

  if (f.primary === "TRANSFER_IN") {
    if (namesUser(f, context)) return ownMovement(false, namedBanks(f, ctx, self), f);
    const banks = namedBanks(f, ctx, self);
    if (banks.length) return ownMovement(false, banks, f);
    if (f.detailed === FROM_APPS_IN || isApp) return "reimbursement";
    return "other_inflow";
  }

  if (isApp && (f.primary === "OTHER" || f.primary === "")) return "reimbursement";

  // A negative amount in a purchase category is money back from a merchant.
  if (isMerchantPrimary(f)) return "refund";

  return "other_inflow";
}
