/**
 * Safe to spend, bill calendar and balances — end to end through the route
 * handlers against PGlite. Synthetic data only.
 *
 * Ports of verify-calcs repros: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 4.1, 4.2, N3, N9.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import { userPreferences } from "@/lib/db/schema/user-preferences";
import { makeUser, makePlaidItem, makeAccount, makeTxn } from "../setup/factories";

const ctx = vi.hoisted(() => ({ userId: "user_a", tz: "UTC" as string | null }));
vi.mock("@/lib/auth/get-session", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: ctx.userId } })),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "tz" && ctx.tz ? { name, value: ctx.tz } : undefined),
  }),
  headers: async () => new Headers(),
}));

import { GET as safeToSpendGET } from "@/app/api/safe-to-spend/route";
import { GET as billCalendarGET } from "@/app/api/bill-calendar/route";
import { getAccountsWithBalances, getBalanceSummary } from "@/lib/db/queries/accounts";

const U = "user_a";
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
// Sat 2026-08-15 16:00 UTC (noon US-Eastern).
const NOW = new Date("2026-08-15T16:00:00Z");

type StreamInsert = typeof recurringStreams.$inferInsert;
function stream(over: Partial<StreamInsert> & { streamId: string }): StreamInsert {
  return {
    userId: U,
    plaidItemId: "pi_a",
    accountId: "chk",
    flowType: "outflow",
    description: "Generic Bill",
    merchantName: null,
    frequency: "MONTHLY",
    status: "MATURE",
    isActive: true,
    predictedNextDate: d("2026-08-18"),
    lastDate: d("2026-07-18"),
    averageAmount: "100",
    lastAmount: "100",
    pfcPrimary: "GENERAL_SERVICES",
    ...over,
  };
}

let seq = 0;
const txn = (over: Parameters<typeof makeTxn>[0]) => {
  seq++;
  return makeTxn({ id: `t${seq}`, userId: U, plaidTransactionId: `pt${seq}`, ...over });
};

async function getSafe() {
  const res = await safeToSpendGET();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  ctx.userId = U;
  ctx.tz = "UTC";
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: U, email: "a@test.local" }));
  await db.insert(plaidItems).values(makePlaidItem({ id: "pi_a", userId: U, itemId: "item_a" }));
  await db.insert(financialAccounts).values([
    makeAccount({ id: "chk", userId: U, plaidItemId: "pi_a", name: "Checking", type: "depository", subtype: "checking", currentBalance: "1000.00", availableBalance: "1000.00", lastSyncedAt: NOW }),
    makeAccount({ id: "card", userId: U, plaidItemId: "pi_a", name: "Card", type: "credit", subtype: "credit card", currentBalance: "300.00", availableBalance: "4700.00", lastSyncedAt: NOW }),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("safe to spend — definition", () => {
  async function seedLoanAndPaycheck() {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({ id: "loan", userId: U, plaidItemId: "pi_a", name: "Student Loan", type: "loan", subtype: "student", currentBalance: "20000.00", availableBalance: null, lastSyncedAt: NOW }),
      makeAccount({ id: "inv", userId: U, plaidItemId: "pi_a", name: "Brokerage", type: "investment", subtype: "brokerage", currentBalance: null, availableBalance: null, lastSyncedAt: null }),
    ]);
    await db.insert(recurringStreams).values([
      stream({ streamId: "s_pay", flowType: "inflow", description: "PAYROLL", frequency: "BIWEEKLY", predictedNextDate: d("2026-08-20"), lastDate: d("2026-08-06"), averageAmount: "-2000", lastAmount: "-2000", pfcPrimary: "INCOME" }),
      stream({ streamId: "s_rent", description: "RENT", predictedNextDate: d("2026-08-18"), lastDate: d("2026-07-18"), averageAmount: "1200", lastAmount: "1200", pfcPrimary: "RENT_AND_UTILITIES" }),
    ]);
  }

  it("verify-calcs 7.2: loan, card and an unavailable investment do not wreck the number", async () => {
    await seedLoanAndPaycheck();
    const data = await getSafe();
    // cash 1000 − rent 1200 − card balance 300 (no card-payment schedule) = −500.
    // Old code: 1000 − 300 − 20000 + 2000 − 1200 = −18,500.
    expect(data.safe_to_spend).toBe(-500);
    expect(data.cash).toBe(1000);
    expect(data.card_mode).toBe("card_balance");
    expect(data.card_obligations).toBe(300);
  });

  it("verify-calcs 7.3: the horizon ends the day before the anchoring paycheck; the paycheck is not added", async () => {
    await seedLoanAndPaycheck();
    const data = await getSafe();
    expect(data.horizon_source).toBe("next_paycheck");
    expect(data.paycheck.date).toBe("2026-08-20");
    expect(data.through).toBe("2026-08-19");
    expect(data.upcoming.map((u: { stream_id: string }) => u.stream_id)).toEqual(["s_rent"]);
  });

  it("only an INCOME stream anchors the horizon (a Venmo-style inflow does not)", async () => {
    await seedLoanAndPaycheck();
    await getTestDb().insert(recurringStreams).values(
      stream({ streamId: "s_p2p", flowType: "inflow", description: "Roommate A", frequency: "WEEKLY", predictedNextDate: d("2026-08-16"), lastDate: d("2026-08-09"), averageAmount: "-50", lastAmount: "-50", pfcPrimary: "TRANSFER_IN" }),
    );
    const data = await getSafe();
    expect(data.paycheck.stream_id).toBe("s_pay");
    expect(data.through).toBe("2026-08-19");
  });

  it("verify-calcs 7.5: transfers are not bills, and a card-payment schedule replaces card balances (never both)", async () => {
    await seedLoanAndPaycheck();
    await getTestDb().insert(recurringStreams).values([
      stream({ streamId: "s_save", description: "Transfer to Savings", predictedNextDate: d("2026-08-17"), lastDate: d("2026-07-17"), averageAmount: "500", lastAmount: "500", pfcPrimary: "TRANSFER_OUT", pfcDetailed: "TRANSFER_OUT_SAVINGS" }),
      stream({ streamId: "s_cc", description: "Payment to Card ending 1234", predictedNextDate: d("2026-08-17"), lastDate: d("2026-07-17"), averageAmount: "250", lastAmount: "250", pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
    ]);
    const data = await getSafe();
    expect(data.card_mode).toBe("payment_stream");
    expect(data.card_obligations).toBe(250);
    expect(data.bills).toBe(1200);
    // 1000 − 1200 − 250; the 300 card balance is NOT also subtracted.
    expect(data.safe_to_spend).toBe(-450);
    expect(data.upcoming.map((u: { stream_id: string }) => u.stream_id).sort()).toEqual(["s_cc", "s_rent"]);
  });

  it("a card payment due after payday is not subtracted before it", async () => {
    await seedLoanAndPaycheck();
    await getTestDb().insert(recurringStreams).values(
      stream({ streamId: "s_cc", description: "Payment to Card", predictedNextDate: d("2026-08-25"), lastDate: d("2026-07-25"), averageAmount: "250", lastAmount: "250", pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
    );
    const data = await getSafe();
    expect(data.card_mode).toBe("payment_stream");
    expect(data.card_obligations).toBe(0);
    expect(data.safe_to_spend).toBe(-200);
  });

  it("verify-calcs 7.1: a stream silent for over a cycle is 'possibly ended', not a bill", async () => {
    await seedLoanAndPaycheck();
    await getTestDb().insert(recurringStreams).values(
      // Card payment last seen 2026-06-10, predicted 2026-07-10: ~36 days overdue.
      stream({ streamId: "s_old_cc", description: "Old Card Online Payment", predictedNextDate: d("2026-07-10"), lastDate: d("2026-06-10"), averageAmount: "900", lastAmount: "900", pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
    );
    const data = await getSafe();
    expect(data.possibly_ended.map((p: { stream_id: string }) => p.stream_id)).toEqual(["s_old_cc"]);
    // A stale card-payment stream is not a schedule: fall back to the balance.
    expect(data.card_mode).toBe("card_balance");
    expect(data.safe_to_spend).toBe(-500);
  });

  it("verify-calcs 7.7: tentative streams are listed, not summed", async () => {
    await seedLoanAndPaycheck();
    await getTestDb().insert(recurringStreams).values(
      stream({ streamId: "s_new", status: "EARLY_DETECTION", description: "New Streaming Service", predictedNextDate: d("2026-08-17"), lastDate: d("2026-07-17"), averageAmount: "15", lastAmount: "15", pfcPrimary: "ENTERTAINMENT" }),
    );
    const data = await getSafe();
    expect(data.tentative.map((t: { stream_id: string }) => t.stream_id)).toEqual(["s_new"]);
    expect(data.safe_to_spend).toBe(-500);
  });

  it("verify-calcs 7.6: a bill already posted (linked) or pending (unlinked) is not counted again", async () => {
    await seedLoanAndPaycheck();
    const db = getTestDb();
    await db.insert(recurringStreams).values(
      stream({ streamId: "s_gym", description: "CITY GYM", merchantName: "City Gym", frequency: "MONTHLY", predictedNextDate: d("2026-08-15"), lastDate: d("2026-07-15"), averageAmount: "30", lastAmount: "30", pfcPrimary: "PERSONAL_CARE" }),
    );
    await db.insert(transactions).values([
      // Rent paid early and linked by Plaid; predicted_next_date not advanced yet.
      txn({ accountId: "chk", amount: "1200.00", date: d("2026-08-15"), name: "RENT", recurringStreamId: "s_rent" }),
      // Gym charge pending today, not linked to the stream yet.
      txn({ accountId: "chk", amount: "30.00", date: d("2026-08-15"), name: "CITY GYM 0815", merchantName: "City Gym", pending: true }),
    ]);
    const data = await getSafe();
    expect(data.upcoming).toEqual([]);
    expect(data.bills).toBe(0);
    // The pending charge is already in the spendable balance.
    expect(data.cash).toBe(970);
    expect(data.safe_to_spend).toBe(970 - 300);
  });

  it("excludes closed and non-USD accounts and flags stale ones", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({ id: "old", userId: U, plaidItemId: "pi_a", name: "Old Savings", type: "depository", subtype: "savings", currentBalance: "5000.00", availableBalance: "5000.00", closedAt: d("2026-08-01"), lastSyncedAt: NOW }),
      makeAccount({ id: "eur", userId: U, plaidItemId: "pi_a", name: "Euro Account", type: "depository", subtype: "checking", currentBalance: "900.00", availableBalance: "900.00", isoCurrencyCode: "EUR", lastSyncedAt: NOW }),
      makeAccount({ id: "sav", userId: U, plaidItemId: "pi_a", name: "Savings", type: "depository", subtype: "savings", currentBalance: "250.00", availableBalance: null, lastSyncedAt: new Date("2026-08-05T00:00:00Z") }),
    ]);
    const data = await getSafe();
    expect(data.cash).toBe(1250);
    expect(data.excluded_accounts).toEqual([{ id: "eur", name: "Euro Account", reason: "foreign_currency" }]);
    expect(data.stale_accounts.map((a: { id: string }) => a.id)).toEqual(["sav"]);
    expect(data.horizon_source).toBe("default_30d");
    expect(data.through).toBe("2026-09-13");
  });
});

describe("verify-calcs N3 — 'today' is the user's calendar date", () => {
  it("at 8:30pm New York on Aug 31 today is Aug 31, not Sep 1", async () => {
    vi.setSystemTime(new Date("2026-09-01T00:30:00Z"));
    ctx.tz = "America/New_York";
    await getTestDb().insert(recurringStreams).values(
      stream({ streamId: "s_util", description: "Power Co", predictedNextDate: d("2026-08-31"), lastDate: d("2026-07-31"), averageAmount: "80", lastAmount: "80", pfcPrimary: "RENT_AND_UTILITIES" }),
    );
    const data = await getSafe();
    expect(data.today).toBe("2026-08-31");
    expect(data.upcoming).toEqual([
      expect.objectContaining({ stream_id: "s_util", date: "2026-08-31", late: false }),
    ]);
  });

  it("a saved time-zone preference overrides the browser cookie", async () => {
    vi.setSystemTime(new Date("2026-09-01T00:30:00Z"));
    ctx.tz = "UTC";
    await getTestDb().insert(userPreferences).values({ userId: U, timeZone: "America/Chicago" });
    const data = await getSafe();
    expect(data.today).toBe("2026-08-31");
  });
});

describe("bill calendar", () => {
  async function calendar(from: string, to: string) {
    const res = await billCalendarGET(new Request(`http://x/api/bill-calendar?from=${from}&to=${to}`));
    return { status: res.status, body: await res.json() };
  }

  it("shows posted rows before today and projections from today, without stale streams", async () => {
    const db = getTestDb();
    await db.insert(recurringStreams).values([
      stream({ streamId: "s_rent", description: "RENT", predictedNextDate: d("2026-08-18"), lastDate: d("2026-07-18"), averageAmount: "1200", lastAmount: "1200", pfcPrimary: "RENT_AND_UTILITIES" }),
      stream({ streamId: "s_old", description: "Old Utility", predictedNextDate: d("2026-07-23"), lastDate: d("2026-06-23"), averageAmount: "115", lastAmount: "115", pfcPrimary: "RENT_AND_UTILITIES" }),
      stream({ streamId: "s_gym", description: "Gym", frequency: "BIWEEKLY", predictedNextDate: d("2026-08-14"), lastDate: d("2026-07-31"), averageAmount: "30", lastAmount: "30", pfcPrimary: "PERSONAL_CARE" }),
    ]);
    await db.insert(transactions).values(
      txn({ accountId: "chk", amount: "30.00", date: d("2026-07-31"), name: "Gym", recurringStreamId: "s_gym" }),
    );
    const { status, body } = await calendar("2026-07-01", "2026-08-31");
    expect(status).toBe(200);
    expect(body.data.today).toBe("2026-08-15");
    const rows = body.data.events.map((e: { stream_id: string; date: string; posted: boolean; late: boolean }) => [e.stream_id, e.date, e.posted, e.late]);
    expect(rows).toEqual([
      ["s_gym", "2026-07-31", true, false],
      // Gym was due Aug 14 and has not posted: late, shown today.
      ["s_gym", "2026-08-15", false, true],
      ["s_rent", "2026-08-18", false, false],
      ["s_gym", "2026-08-28", false, false],
    ]);
    expect(body.data.possibly_ended.map((p: { stream_id: string }) => p.stream_id)).toEqual(["s_old"]);
  });

  it("rejects impossible dates and oversized windows", async () => {
    expect((await calendar("2026-02-31", "2026-03-01")).status).toBe(400);
    expect((await calendar("2026-01-01", "2026-12-31")).status).toBe(400);
  });
});

describe("balances", () => {
  it("verify-calcs 4.2: projected balance from pending 0.10 + 0.20 is cent-exact", async () => {
    const db = getTestDb();
    await db.update(financialAccounts).set({ currentBalance: "0.00", availableBalance: null });
    await db.insert(transactions).values([
      txn({ accountId: "chk", amount: "-0.10", date: d("2026-08-14"), name: "a", pending: true }),
      txn({ accountId: "chk", amount: "-0.20", date: d("2026-08-14"), name: "b", pending: true }),
    ]);
    const accounts = await getAccountsWithBalances(U);
    const chk = accounts.find((a) => a.id === "chk")!;
    expect(chk.projectedBalance).toBe(0.3);
    expect(chk.pendingSum).toBe(-0.3);
    const summary = await getBalanceSummary(U);
    expect(summary.projectedNetWorth).toBe(0.3);
  });

  it("verify-calcs 4.3: pending older than 14 days is ignored; card `available` never used", async () => {
    await getTestDb().insert(transactions).values([
      txn({ accountId: "chk", amount: "50.00", date: d("2026-07-01"), name: "abandoned hold", pending: true }),
      txn({ accountId: "card", amount: "20.00", date: d("2026-08-14"), name: "card pending", pending: true }),
    ]);
    const accounts = await getAccountsWithBalances(U);
    expect(accounts.find((a) => a.id === "chk")!.projectedBalance).toBe(1000);
    expect(accounts.find((a) => a.id === "card")!.projectedBalance).toBe(320);
  });

  it("verify-calcs 4.1 / N9: summary excludes closed, unavailable and non-USD accounts with flags", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({ id: "inv", userId: U, plaidItemId: "pi_a", name: "Brokerage", type: "investment", subtype: "brokerage", currentBalance: null, availableBalance: null, lastSyncedAt: null }),
      makeAccount({ id: "old", userId: U, plaidItemId: "pi_a", name: "Old Savings", type: "depository", currentBalance: "5000.00", closedAt: d("2026-08-01"), lastSyncedAt: NOW }),
      makeAccount({ id: "eur", userId: U, plaidItemId: "pi_a", name: "Euro Account", type: "depository", currentBalance: "900.00", isoCurrencyCode: "EUR", lastSyncedAt: NOW }),
      makeAccount({ id: "loan", userId: U, plaidItemId: "pi_a", name: "Loan", type: "loan", currentBalance: "2000.10", availableBalance: null, lastSyncedAt: new Date("2026-08-01T00:00:00Z") }),
    ]);
    const s = await getBalanceSummary(U);
    expect(s.netWorth).toBe(1000 - 300 - 2000.1);
    expect(s.liquidCash).toBe(1000);
    expect(s.creditDebt).toBe(300);
    expect(s.loanDebt).toBe(2000.1);
    expect(s.investments).toBeNull();
    expect(s.unavailableAccounts.map((a) => a.id)).toEqual(["inv"]);
    expect(s.foreignCurrencyAccounts).toEqual([{ id: "eur", name: "Euro Account", currency: "EUR" }]);
    expect(s.staleAccounts.map((a) => a.id)).toEqual(["loan"]);
  });
});
