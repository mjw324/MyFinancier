import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { db as appDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { postProcessTransactions } from "@/lib/plaid/post-process";
import { applyPairPlan } from "@/lib/plaid/transfers";
import { lockUserFlows } from "@/lib/analytics/apply-flow-classes";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";

// Synthetic fixtures only.
const U = "u_w2";
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function seedAccounts() {
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: U, name: "Alex Sample", email: "w2@test.local" }));
  await db.insert(plaidItems).values([
    makePlaidItem({ id: "pi_bank", userId: U, itemId: "it_bank", institutionName: "Northwind Bank" }),
    makePlaidItem({ id: "pi_card", userId: U, itemId: "it_card", institutionName: "Fabrikam Invest" }),
    makePlaidItem({ id: "pi_app", userId: U, itemId: "it_app", institutionName: "Venmo - Personal" }),
  ]);
  await db.insert(financialAccounts).values([
    makeAccount({ id: "chk", userId: U, plaidItemId: "pi_bank", name: "Everyday Checking", type: "depository" }),
    makeAccount({ id: "card", userId: U, plaidItemId: "pi_card", name: "Fabrikam Credit Card", type: "credit", subtype: "credit card" }),
    makeAccount({ id: "inv", userId: U, plaidItemId: "pi_card", name: "Fabrikam Roth IRA", type: "investment", subtype: "roth" }),
    makeAccount({ id: "wallet", userId: U, plaidItemId: "pi_app", name: "Personal Profile", type: "depository" }),
  ]);
}

function t(id: string, accountId: string, amount: string, date: string, over: Record<string, unknown> = {}) {
  return makeTxn({ id, userId: U, accountId, amount, date: d(date), createdAt: d(date), ...over });
}

async function rows() {
  const db = getTestDb();
  const all = await db.select().from(transactions).where(eq(transactions.userId, U));
  return new Map(all.map((r) => [r.id, r]));
}

beforeEach(async () => {
  await seedAccounts();
  await getTestDb().insert(transactions).values([
    // History anchors so every account has a window covering March.
    t("chk_first", "chk", "5.00", "2026-01-02", { name: "Corner Store", category: "GENERAL_MERCHANDISE" }),
    t("card_first", "card", "5.00", "2026-01-02", { name: "Corner Store", category: "GENERAL_MERCHANDISE" }),
    t("wallet_first", "wallet", "5.00", "2026-01-02", { name: "Corner Store", category: "GENERAL_MERCHANDISE" }),
    t("chk_last", "chk", "5.00", "2026-03-30", { name: "Corner Store", category: "GENERAL_MERCHANDISE" }),
    t("card_last", "card", "5.00", "2026-03-30", { name: "Corner Store", category: "GENERAL_MERCHANDISE" }),
    t("wallet_last", "wallet", "5.00", "2026-03-30", { name: "Corner Store", category: "GENERAL_MERCHANDISE" }),
    // Card payment Plaid labels as an investment transfer, and the card credit.
    t("pay_bank", "chk", "412.57", "2026-03-04", {
      name: "Fabrikam", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    }),
    t("pay_card", "card", "-412.57", "2026-03-01", {
      name: "Payment", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    }),
    // A genuine brokerage deposit.
    t("invest", "chk", "1000.00", "2026-02-10", {
      name: "Fabrikam", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    }),
    // The known false pair: a purchase and an unrelated receipt sharing a pair id.
    t("carwash", "card", "12.00", "2026-03-13", { name: "CAR WASH", category: "GENERAL_SERVICES", transferPairId: "false-pair", isTransfer: true }),
    t("receipt", "wallet", "-12.00", "2026-03-14", { name: 'Pat Example "snacks"', category: "OTHER", categoryId: "OTHER_OTHER", transferPairId: "false-pair", isTransfer: true }),
    // An orphan: its partner was deleted (pending → posted delete-and-insert).
    t("orphan", "wallet", "120.00", "2026-03-20", { name: "Standard transfer", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_ACCOUNT_TRANSFER", transferPairId: "gone" }),
    t("arrival", "chk", "-120.00", "2026-03-21", { name: "Venmo", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_TRANSFER_IN_FROM_APPS" }),
    // ATM cash and a loan-category inflow the old refund detector mis-flagged.
    t("atm", "chk", "200.00", "2026-03-05", { name: "ATM WITHDRAWAL 0001", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_WITHDRAWAL" }),
    // A manual decision that must survive.
    t("manual", "chk", "-50.00", "2026-03-06", { name: "Mobile Deposit", category: "TRANSFER_IN", flowClass: "income", flowClassSource: "manual" }),
    // A legacy manual refund decision (before flow classes existed).
    t("legacy_refund", "chk", "-30.00", "2026-03-07", { name: "Mystery Credit", category: "OTHER", isRefund: true, refundSource: "manual" }),
  ]);
});

describe("postProcessTransactions", () => {
  it("classifies every NULL row, pairs both legs, clears false and orphaned pairs, keeps manual", async () => {
    const result = await postProcessTransactions(U, []);
    const r = await rows();
    for (const row of r.values()) expect(row.flowClass, row.id).not.toBeNull();

    // Card payment disguised as an investment transfer: paired, both legs internal.
    expect(r.get("pay_bank")!.transferPairId).toBeTruthy();
    expect(r.get("pay_bank")!.transferPairId).toBe(r.get("pay_card")!.transferPairId);
    expect(r.get("pay_bank")!.flowClass).toBe("cc_payment");
    expect(r.get("pay_card")!.flowClass).toBe("cc_payment");
    expect(r.get("pay_bank")!.isTransfer).toBe(true);
    expect(r.get("invest")!.flowClass).toBe("savings_out");

    // False pair dissolved and each leg classified on its own.
    expect(r.get("carwash")!.transferPairId).toBeNull();
    expect(r.get("receipt")!.transferPairId).toBeNull();
    expect(r.get("carwash")!.flowClass).toBe("spending");
    expect(r.get("carwash")!.isTransfer).toBe(false);
    expect(r.get("receipt")!.flowClass).toBe("reimbursement");
    expect(r.get("receipt")!.isRefund).toBe(true);
    expect(r.get("receipt")!.refundSource).toBe("auto");
    expect(r.get("receipt")!.counterpartyKey).toBe("pat example");

    // Orphan cleared, then re-paired with its real partner.
    expect(r.get("orphan")!.transferPairId).not.toBe("gone");
    expect(r.get("orphan")!.transferPairId).toBe(r.get("arrival")!.transferPairId);
    expect(r.get("orphan")!.flowClass).toBe("internal_transfer");

    expect(r.get("atm")!.flowClass).toBe("cash_withdrawal");
    expect(r.get("atm")!.isTransfer).toBe(false);

    expect(r.get("manual")!.flowClass).toBe("income");
    expect(r.get("manual")!.flowClassSource).toBe("manual");
    expect(r.get("legacy_refund")!.flowClass).toBe("refund");
    expect(r.get("legacy_refund")!.flowClassSource).toBe("manual");

    expect(result.pairsCleared).toBe(2);
    expect(result.pairsCreated).toBe(2);
  });

  it("is idempotent: a second run writes nothing", async () => {
    await postProcessTransactions(U, []);
    const before = await rows();
    const second = await postProcessTransactions(U, []);
    expect(second.updated).toBe(0);
    expect(second.pairsCreated).toBe(0);
    expect(second.pairsCleared).toBe(0);
    const after = await rows();
    for (const [id, row] of after) {
      expect(row.flowClass, id).toBe(before.get(id)!.flowClass);
      expect(row.transferPairId, id).toBe(before.get(id)!.transferPairId);
    }
  });

  it("reclassifies the existing leg when its partner arrives in a later sync", async () => {
    const db = getTestDb();
    await db.delete(transactions).where(eq(transactions.id, "pay_card"));
    await postProcessTransactions(U, []);
    expect((await rows()).get("pay_bank")!.flowClass).toBe("savings_out");

    await db.insert(transactions).values(
      t("pay_card2", "card", "-412.57", "2026-03-01", { name: "Payment", category: "LOAN_PAYMENTS", categoryId: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
    );
    await postProcessTransactions(U, ["pay_card2"]);
    const r = await rows();
    expect(r.get("pay_bank")!.flowClass).toBe("cc_payment");
    expect(r.get("pay_card2")!.flowClass).toBe("cc_payment");
  });

  it("self-heals rows left unclassified by an earlier failed run", async () => {
    await postProcessTransactions(U, []);
    const db = getTestDb();
    await db.update(transactions).set({ flowClass: null, flowClassSource: null }).where(eq(transactions.id, "atm"));
    await postProcessTransactions(U, []);
    expect((await rows()).get("atm")!.flowClass).toBe("cash_withdrawal");
  });

  it("never writes a one-sided pair when a leg changed concurrently (guarded update)", async () => {
    const db = getTestDb();
    await db.update(transactions).set({ transferPairId: "taken" }).where(eq(transactions.id, "arrival"));
    const applied = await appDb.transaction(async (tx) => {
      await lockUserFlows(tx, U);
      return applyPairPlan(tx, U, {
        clear: [],
        clearedRowIds: [],
        create: [{ pairId: "new-pair", outId: "orphan", inId: "arrival" }],
      });
    });
    expect(applied.created).toEqual([]);
    expect(applied.failed).toHaveLength(1);
    const r = await rows();
    expect(r.get("orphan")!.transferPairId).toBe("gone");
    expect(r.get("arrival")!.transferPairId).toBe("taken");
  });
});
