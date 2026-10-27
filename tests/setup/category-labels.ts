/**
 * Hand labels (Plaid PFC v2 primaries) for every transaction description in
 * the seed profiles (scripts/seed-profiles.ts), for the categorization
 * accuracy suite. First match wins, so specific patterns come first. A seed
 * description no pattern matches fails the suite: label new seed strings here.
 *
 * Judgement calls: card payments are LOAN_PAYMENTS on both sides; ATM cash is
 * TRANSFER_OUT; software subscriptions are GENERAL_SERVICES; warehouse clubs
 * and Amazon are GENERAL_MERCHANDISE; pharmacies are MEDICAL.
 */

import type { PlaidPrimary } from "@/lib/categorize/categories";

const LABELS: Array<[RegExp, PlaidPrimary]> = [
  // Money in
  [/PAYROLL|DIRECT DEP|ACH DEPOSIT .*INVOICE|UPWORK ESCROW|STRIPE TRANSFER|MOBILE CHECK DEPOSIT|INTEREST PAYMENT|TAX REF|CASH BACK REWARD/, "INCOME"],
  [/TRANSFER FROM|ZELLE (PAYMENT )?FROM|FIDELITY .*DISTRIBUTION|BROKERAGE WITHDRAWAL/, "TRANSFER_IN"],
  // Moves out
  [/TRANSFER TO|VENMO PAYMENT TO|ZELLE PAYMENT TO|CONTRIB|ATM WITHDRAWAL/, "TRANSFER_OUT"],
  [/AUTOPAY PAYMENT|AUTOMATIC PAYMENT|PAYMENT - THANK YOU|PAYMENT RECEIVED|PAYMENT THANK YOU|E-PAYMENT|EPAYMENT|ONLINE PMT|CREDIT CRD AUTOPAY|CREDIT CARD AUTO PAY|STUDENT LOAN|MORTGAGE PAYMENT|AUTO PAYMENT/, "LOAN_PAYMENTS"],
  [/OVERDRAFT FEE|LATE FEE|INTEREST CHARGE|CARD VERIFICATION/, "BANK_FEES"],
  [/IRS .*TAX|PROPERTY TAX|DMV/, "GOVERNMENT_AND_NON_PROFIT"],
  [/RENT|COMCAST|T-MOBILE|VERIZON|PG&E|POWER & LIGHT|WATER SEWER/, "RENT_AND_UTILITIES"],
  [/INSURANCE|CHILDCARE|WEWORK|ADOBE|GITHUB|OPENAI/, "GENERAL_SERVICES"],
  [/WHOLE FOODS|TRADER JOE|SAFEWAY|CHIPOTLE|STARBUCKS|SWEETGREEN|DOORDASH|UBER \*EATS|DINER|RESTAURANTE/, "FOOD_AND_DRINK"],
  [/SHELL OIL|CHEVRON|UBER \*TRIP|LYFT/, "TRANSPORTATION"],
  [/DELTA AIR|MARRIOTT/, "TRAVEL"],
  [/AMC THEATRES|STEAM GAMES|TICKETMASTER|NETFLIX|SPOTIFY|HULU/, "ENTERTAINMENT"],
  [/HOME DEPOT|LOWES/, "HOME_IMPROVEMENT"],
  [/CVS|WALGREENS|KAISER|DENTAL/, "MEDICAL"],
  [/GREAT CLIPS|EQUINOX/, "PERSONAL_CARE"],
  [/AMAZON|TARGET|BEST BUY|B&H PHOTO|NORDSTROM|UNIQLO|BUY BUY BABY|COSTCO/, "GENERAL_MERCHANDISE"],
];

/** `amount` is Plaid-signed: positive = money out. */
export function labelFor(description: string, amount: number): PlaidPrimary | null {
  if (/PAYPAL TRANSFER/.test(description)) return amount < 0 ? "TRANSFER_IN" : "TRANSFER_OUT";
  for (const [re, label] of LABELS) if (re.test(description)) return label;
  return null;
}
