import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";
import {
  getCashFlow,
  getDailySpending,
  getFixedVsVariable,
  getIncomeCadence,
  getIncomeSources,
  getPace,
  getSpendingByBucket,
  getTopMerchants,
  periodScope,
} from "@/lib/analytics/metrics";
import { calendarPeriod } from "@/lib/analytics/periods";
import { projectPace } from "@/lib/analytics/trends";
import { calendarDateInTimeZone } from "@/lib/utils/time-zone";
import { resolveDashboardPeriod } from "@/lib/utils/date-ranges";
import { sumMoney } from "@/lib/utils/money";
import {
  getTransactionTotals,
  searchTransactions,
} from "@/lib/db/queries/transactions";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";

const U = "u_metrics";
const OTHER = "u_other";
const AUG = calendarPeriod("month", new Date("2026-08-15T00:00:00Z"));
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const cents = (n: number) => Math.round(n * 100);

type Over = Parameters<typeof makeTxn>[0];

async function seedBase() {
  const db = getTestDb();
  await db.insert(user).values([
    makeUser({ id: U, email: "m@test.local" }),
    makeUser({ id: OTHER, email: "o@test.local" }),
  ]);
  await db.insert(plaidItems).values([
    makePlaidItem({ id: "pi", userId: U, itemId: "it" }),
    makePlaidItem({ id: "pi_o", userId: OTHER, itemId: "it_o" }),
  ]);
  await db.insert(financialAccounts).values([
    makeAccount({ id: "chk", userId: U, plaidItemId: "pi", type: "depository" }),
    makeAccount({ id: "card", userId: U, plaidItemId: "pi", type: "credit", subtype: "credit card" }),
    makeAccount({ id: "o_chk", userId: OTHER, plaidItemId: "pi_o" }),
  ]);
}

function t(id: string, amount: string, flowClass: string | null, date: string, over: Over = {}) {
  return makeTxn({
    id,
    userId: U,
    accountId: "chk",
    amount,
    flowClass,
    date: day(date),
    ...over,
  });
}

/**
 * August 2026, synthetic. Expected figures (by hand):
 *   income 4000, other income 5.25           → money in 4005.25
 *   gross spending 2118.32
 *   refunds 20.40, reimbursements 350, rewards 10 → offsets 380.40
 *   net spending 1737.92
 *   saved out 400, back 100                  → saved/moved 300
 *   net change 4005.25 − 1737.92 − 300 = 1967.33
 */
async function seedAugust() {
  const db = getTestDb();
  await db.insert(recurringStreams).values({
    streamId: "stream_tv",
    userId: U,
    plaidItemId: "pi",
    accountId: "card",
    flowType: "outflow",
    description: "STREAMCO",
    frequency: "MONTHLY",
    status: "MATURE",
    averageAmount: "15.99",
    lastAmount: "15.99",
  });
  await db.insert(transactions).values([
    t("pay1", "-2000.00", "income", "2026-08-01", { category: "INCOME", counterpartyKey: "acme payroll" }),
    t("pay2", "-2000.00", "income", "2026-08-15", { category: "INCOME", counterpartyKey: "acme payroll" }),
    t("interest", "-5.25", "other_inflow", "2026-08-31", { category: "INCOME" }),
    t("rent", "1500.00", "spending", "2026-08-02", { category: "RENT_AND_UTILITIES", counterpartyKey: "landlord co" }),
    t("groceries", "120.40", "spending", "2026-08-05", { accountId: "card", category: "FOOD_AND_DRINK", merchantName: "Grocer", counterpartyKey: "grocer" }),
    t("coffee", "4.60", "spending", "2026-08-06", { accountId: "card", category: "FOOD_AND_DRINK", merchantName: "Coffee Shop", counterpartyKey: "coffee shop" }),
    t("refund", "-20.40", "refund", "2026-08-09", { accountId: "card", category: "FOOD_AND_DRINK", merchantName: "Grocer", counterpartyKey: "grocer" }),
    t("roommate_dinner", "-50.00", "reimbursement", "2026-08-03", { category: "TRANSFER_IN", counterpartyKey: "roommate a" }),
    t("roommate_rent", "-300.00", "reimbursement", "2026-08-04", { category: "TRANSFER_IN", customCategory: "RENT_AND_UTILITIES", counterpartyKey: "roommate a" }),
    t("atm", "60.00", "cash_withdrawal", "2026-08-10", { category: "TRANSFER_OUT" }),
    t("venmo_out", "45.00", "p2p_payment", "2026-08-11", { category: "TRANSFER_OUT", counterpartyKey: "friend b" }),
    t("loan", "250.00", "debt_payment", "2026-08-12", { category: "LOAN_PAYMENTS", counterpartyKey: "student loans" }),
    t("reward", "-10.00", "card_reward", "2026-08-13", { accountId: "card", category: "INCOME" }),
    t("invest", "400.00", "savings_out", "2026-08-14", { category: "TRANSFER_OUT" }),
    t("invest_back", "-100.00", "savings_in", "2026-08-20", { category: "TRANSFER_IN" }),
    t("tv", "15.99", "spending", "2026-08-08", { accountId: "card", category: "ENTERTAINMENT", recurringStreamId: "stream_tv", counterpartyKey: "streamco" }),
    t("insurance", "89.00", "spending", "2026-08-18", { category: "GENERAL_SERVICES", categoryId: "GENERAL_SERVICES_INSURANCE", counterpartyKey: "insurer" }),
    // No category, no category id, no merchant: must still land in a bucket
    // and on the variable side of fixed/variable.
    t("mystery", "33.33", "spending", "2026-08-19", { category: null, categoryId: null, name: "POS 1234" }),
    t("cc_out", "700.00", "cc_payment", "2026-08-25", { category: "LOAN_PAYMENTS" }),
    t("cc_in", "-700.00", "cc_payment", "2026-08-25", { accountId: "card", category: "LOAN_PAYMENTS" }),
    t("move_out", "50.00", "internal_transfer", "2026-08-26", { category: "TRANSFER_OUT" }),
    t("move_in", "-50.00", "internal_transfer", "2026-08-26", { category: "TRANSFER_IN" }),
    // Not classified yet: never counted.
    t("unclassified", "999.00", null, "2026-08-16", { category: "GENERAL_MERCHANDISE" }),
    // Outside August.
    t("jul31", "77.00", "spending", "2026-07-31", { category: "FOOD_AND_DRINK" }),
    t("sep1", "88.00", "spending", "2026-09-01", { category: "FOOD_AND_DRINK" }),
    // Another user's August spending.
    makeTxn({ id: "o_food", userId: OTHER, accountId: "o_chk", amount: "500.00", flowClass: "spending", category: "FOOD_AND_DRINK", date: day("2026-08-05") }),
  ]);
}

beforeEach(async () => {
  await seedBase();
});

describe("cash flow", () => {
  beforeEach(seedAugust);

  it("computes every line and the identity closes to the cent", async () => {
    const f = await getCashFlow(periodScope(U, AUG));
    expect(f.income).toBe(4000);
    expect(f.otherIncome).toBe(5.25);
    expect(f.moneyIn).toBe(4005.25);
    expect(f.grossSpending).toBe(2118.32);
    expect(f.refunds).toBe(20.4);
    expect(f.reimbursements).toBe(350);
    expect(f.rewards).toBe(10);
    expect(f.offsets).toBe(380.4);
    expect(f.netSpending).toBe(1737.92);
    expect(f.savedOut).toBe(400);
    expect(f.savedIn).toBe(100);
    expect(f.savedNet).toBe(300);
    expect(f.netChange).toBe(1967.33);
    // Identity, in cents.
    expect(cents(f.moneyIn) - cents(f.netSpending) - cents(f.savedNet)).toBe(cents(f.netChange));
    expect(cents(f.grossSpending) - cents(f.offsets)).toBe(cents(f.netSpending));
    expect(f.unclassifiedCount).toBe(1);
    expect(f.byClass.cash_withdrawal).toEqual({ total: 60, count: 1 });
    expect(f.byClass.savings_in).toEqual({ total: 100, count: 1 });
    expect(f.byClass.cc_payment).toEqual({ total: 1400, count: 2 });
  });

  it("counts reimbursements against spending, never as income", async () => {
    const f = await getCashFlow(periodScope(U, AUG));
    expect(f.moneyIn).toBe(4005.25); // the 350 from Roommate A is not here
    expect(f.reimbursements).toBe(350);
    const sources = await getIncomeSources(periodScope(U, AUG));
    expect(sources.map((s) => s.key)).toEqual(["acme payroll"]);
  });

  it("is scoped to the user and the period", async () => {
    const other = await getCashFlow(periodScope(OTHER, AUG));
    expect(other.netSpending).toBe(500);
    const f = await getCashFlow(periodScope(U, AUG));
    expect(f.rowCount).toBe(23); // 25 rows of U minus Jul 31 and Sep 1
  });
});

describe("spending by bucket", () => {
  beforeEach(seedAugust);

  it("nets offsets into buckets, reports negative buckets separately, and sums to net spending", async () => {
    const b = await getSpendingByBucket(periodScope(U, AUG));
    const byBucket = Object.fromEntries(b.buckets.map((x) => [x.bucket, x.net]));
    expect(byBucket).toEqual({
      RENT_AND_UTILITIES: 1200, // 1500 rent − 300 rent share (custom category)
      LOAN_PAYMENTS: 250,
      FOOD_AND_DRINK: 104.6,
      GENERAL_SERVICES: 89,
      CASH_WITHDRAWALS: 60,
      SENT_TO_PEOPLE: 45,
      UNCATEGORIZED: 33.33,
      ENTERTAINMENT: 15.99,
    });
    expect(b.negative.map((x) => [x.bucket, x.net])).toEqual([
      ["REIMBURSEMENTS", -50],
      ["REWARDS", -10],
    ]);
    expect(b.netSpending).toBe(1737.92);
    expect(b.positiveTotal).toBe(1797.92);
    expect(b.buckets[0].bucket).toBe("RENT_AND_UTILITIES");
  });

  it("a bucket drill-down returns exactly the rows summed in the bucket", async () => {
    const b = await getSpendingByBucket(periodScope(U, AUG));
    for (const bucket of [...b.buckets, ...b.negative]) {
      const filters = { bucket: bucket.bucket, startDate: AUG.start, endDate: day("2026-08-31") };
      const rows = await searchTransactions(U, filters, { limit: 1000 });
      expect(rows.length, bucket.bucket).toBe(bucket.count);
      const totals = await getTransactionTotals(U, filters);
      expect(totals.netSpending, bucket.bucket).toBe(bucket.net);
    }
    const food = await searchTransactions(U, {
      bucket: "FOOD_AND_DRINK",
      startDate: AUG.start,
      endDate: day("2026-08-31"),
    });
    expect(food.map((r) => r.id).sort()).toEqual(["coffee", "groceries", "refund"]);
  });
});

describe("fixed vs variable", () => {
  beforeEach(seedAugust);

  it("splits every spending row into exactly one side (NULL-safe)", async () => {
    const fv = await getFixedVsVariable(periodScope(U, AUG));
    // rent 1500 − rent share 300 + loan 250 + streaming 15.99 + insurance 89
    expect(fv.fixed).toBe(1554.99);
    expect(fv.variable).toBe(182.93);
    expect(cents(fv.fixed) + cents(fv.variable)).toBe(cents(fv.total));
    expect(fv.total).toBe(1737.92);
    expect(fv.fixedItems.map((i) => i.key)).toContain("landlord co");

    const variable = await searchTransactions(U, {
      cost: "variable",
      startDate: AUG.start,
      endDate: day("2026-08-31"),
    });
    expect(variable.map((r) => r.id)).toContain("mystery");
  });

  it("works for a user with no recurring streams at all", async () => {
    const db = getTestDb();
    await db.insert(transactions).values(
      makeTxn({ id: "o_rent", userId: OTHER, accountId: "o_chk", amount: "900.00", flowClass: "spending", category: "RENT_AND_UTILITIES", date: day("2026-08-02") }),
    );
    const fv = await getFixedVsVariable(periodScope(OTHER, AUG));
    expect(fv.fixed).toBe(900);
    expect(fv.variable).toBe(500);
  });
});

describe("merchants", () => {
  beforeEach(seedAugust);

  it("ranks merchants by net spend, refunds netted, people excluded", async () => {
    const m = await getTopMerchants(periodScope(U, AUG), 3);
    expect(m.map((x) => [x.key, x.total])).toEqual([
      ["landlord co", 1500],
      ["student loans", 250],
      ["grocer", 100],
    ]);
    expect(m[2].label).toBe("Grocer");
  });
});

describe("daily series", () => {
  beforeEach(seedAugust);

  it("is dense (every day, zeros included) and sums to net spending", async () => {
    const series = await getDailySpending(periodScope(U, AUG));
    expect(series).toHaveLength(31);
    expect(series[0].date).toBe("2026-08-01");
    expect(series[30].date).toBe("2026-08-31");
    expect(series.find((p) => p.date === "2026-08-07")!.net).toBe(0);
    expect(series.find((p) => p.date === "2026-08-04")!.net).toBe(-300);
    expect(sumMoney(series.map((p) => p.net))).toBe(1737.92);
  });

  it("stops at `through` for a partial period", async () => {
    const series = await getDailySpending(periodScope(U, AUG), day("2026-08-11"));
    expect(series).toHaveLength(10);
  });
});

describe("pending rows", () => {
  it("counts fresh pending rows and excludes stale ones", async () => {
    const DAY = 86_400_000;
    const today = new Date(Math.floor(Date.now() / DAY) * DAY);
    const ago = (n: number) => new Date(today.getTime() - n * DAY);
    const db = getTestDb();
    await db.insert(transactions).values([
      makeTxn({ id: "fresh", userId: U, accountId: "card", amount: "10.00", flowClass: "spending", pending: true, date: ago(2) }),
      makeTxn({ id: "stale", userId: U, accountId: "card", amount: "99.00", flowClass: "spending", pending: true, date: ago(30) }),
      makeTxn({ id: "posted", userId: U, accountId: "card", amount: "5.00", flowClass: "spending", date: ago(30) }),
    ]);
    const f = await getCashFlow({ userId: U, start: ago(60), end: ago(-1) });
    expect(f.netSpending).toBe(15);
    expect(f.stalePendingCount).toBe(1);
    const b = await getSpendingByBucket({ userId: U, start: ago(60), end: ago(-1) });
    expect(b.netSpending).toBe(15);
  });
});

describe("user time zone", () => {
  it("keeps Aug 31 8:30pm in New York inside August", async () => {
    const db = getTestDb();
    await db.insert(transactions).values([
      t("aug31", "60.00", "spending", "2026-08-31", { category: "FOOD_AND_DRINK" }),
      t("sep01", "40.00", "spending", "2026-09-01", { category: "FOOD_AND_DRINK" }),
    ]);
    // 2026-09-01T00:30Z is 8:30pm on Aug 31 in New York.
    const today = calendarDateInTimeZone(new Date("2026-09-01T00:30:00Z"), "America/New_York");
    const period = resolveDashboardPeriod("month", today);
    expect(period.label).toBe("August 2026");
    expect(period.elapsedDays).toBe(31);
    const f = await getCashFlow(periodScope(U, period));
    expect(f.netSpending).toBe(60);

    // The server's UTC date would already be September.
    const utcToday = calendarDateInTimeZone(new Date("2026-09-01T00:30:00Z"), "UTC");
    expect(resolveDashboardPeriod("month", utcToday).label).toBe("September 2026");
  });
});

describe("empty user", () => {
  it("returns zeros, not errors, for a user with no transactions", async () => {
    const scope = periodScope(OTHER, AUG);
    const f = await getCashFlow(scope);
    expect(f.netChange).toBe(0);
    expect(f.rowCount).toBe(0);
    const b = await getSpendingByBucket(scope);
    expect(b).toEqual({ buckets: [], negative: [], netSpending: 0, positiveTotal: 0 });
    const fv = await getFixedVsVariable(scope);
    expect(fv).toMatchObject({ fixed: 0, variable: 0, total: 0, fixedShare: null });
    const series = await getDailySpending(scope);
    expect(series.every((p) => p.net === 0)).toBe(true);
    const pace = await getPace(OTHER, day("2026-08-15"));
    expect(pace.toDate.total).toBe(0);
    const cadence = await getIncomeCadence(OTHER, day("2026-08-15"), AUG);
    expect(cadence.primary).toBeNull();
  });
});

describe("pace", () => {
  it("separates lumpy fixed costs from the variable run-rate", async () => {
    const db = getTestDb();
    await db.insert(transactions).values([
      // July: rent on the 1st, 30 a day of food on days 1..31 → 930 variable
      t("jul_rent", "1500.00", "spending", "2026-07-01", { category: "RENT_AND_UTILITIES" }),
      ...Array.from({ length: 31 }, (_, i) =>
        t(`jul_food_${i}`, "30.00", "spending", `2026-07-${String(i + 1).padStart(2, "0")}`, { category: "FOOD_AND_DRINK" }),
      ),
      // August, through the 10th: rent on the 2nd, 45 a day of food
      t("aug_rent", "1500.00", "spending", "2026-08-02", { category: "RENT_AND_UTILITIES" }),
      ...Array.from({ length: 10 }, (_, i) =>
        t(`aug_food_${i}`, "45.00", "spending", `2026-08-${String(i + 1).padStart(2, "0")}`, { category: "FOOD_AND_DRINK" }),
      ),
    ]);
    const pace = await getPace(U, day("2026-08-10"));
    expect(pace.period.label).toBe("August 2026");
    expect(pace.toDate).toEqual({ total: 1950, fixed: 1500, variable: 450 });
    expect(pace.comparisonToDate).toEqual({ total: 1800, fixed: 1500, variable: 300 });
    expect(pace.comparisonTotal).toEqual({ total: 2430, fixed: 1500, variable: 930 });
    expect(pace.series[9]).toEqual({ day: 10, current: 1950, comparison: 1800 });
    expect(pace.series[10].current).toBeNull();
    expect(pace.series[30].comparison).toBe(2430);

    const projection = projectPace(pace);
    // Straight-line would say 1950/10*31 = 6045. Fixed stays 1500; variable 45*31.
    expect(projection.projected).toEqual({ fixed: 1500, variable: 1395, total: 2895 });
    expect(projection.variableRatioAhead).toBeCloseTo(0.5, 10);
  });
});

describe("income cadence", () => {
  it("includes the current month (deposits so far are not always 0)", async () => {
    const db = getTestDb();
    // Biweekly paychecks from 2026-04-03; the last one before today is Oct 2.
    const paydays: string[] = [];
    for (let d = day("2026-04-03"); d <= day("2026-10-09"); d = new Date(d.getTime() + 14 * 86_400_000)) {
      paydays.push(d.toISOString().slice(0, 10));
    }
    await db.insert(transactions).values([
      ...paydays.map((p, i) =>
        t(`pay_${i}`, "-1234.56", "income", p, { category: "INCOME", counterpartyKey: "acme payroll" }),
      ),
      // Frequent reimbursements from a roommate are never a pay source.
      ...paydays.map((p, i) =>
        t(`share_${i}`, "-5000.00", "reimbursement", p, { counterpartyKey: "roommate a" }),
      ),
    ]);
    const today = day("2026-10-13");
    const october = calendarPeriod("month", today);
    const c = await getIncomeCadence(U, today, october);
    expect(c.primary?.key).toBe("acme payroll");
    expect(c.primary?.medianAmount).toBe(1234.56);
    expect(c.cadence?.frequency).toBe("biweekly");
    expect(c.depositsInPeriod).toBe(1); // Oct 2
    expect(c.expectedInPeriod).toBe(2);
  });
});
