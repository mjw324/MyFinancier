import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { postProcessTransactions } from "@/lib/plaid/post-process";
import {
  clearManualFlowClass,
  recomputeUserFlowsLocked,
  setManualFlowClass,
  unpairTransfer,
} from "@/lib/analytics/apply-flow-classes";
import { FLOW_CLASS_LABEL } from "@/lib/analytics/flow";
import { FLOW_CLASS_OPTION_LABEL, allowedFlowClasses } from "@/lib/analytics/flow-options";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";

// Synthetic fixtures only.
const U = "u_w2o";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const t = (id: string, accountId: string, amount: string, date: string, over: Record<string, unknown> = {}) =>
  makeTxn({ id, userId: U, accountId, amount, date: d(date), createdAt: d(date), ...over });

async function get(id: string) {
  const [row] = await getTestDb().select().from(transactions).where(eq(transactions.id, id));
  return row;
}

beforeEach(async () => {
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: U, name: "Alex Sample", email: "w2o@test.local" }));
  await db.insert(plaidItems).values([
    makePlaidItem({ id: "pib", userId: U, itemId: "itb", institutionName: "Northwind Bank" }),
    makePlaidItem({ id: "pia", userId: U, itemId: "ita", institutionName: "Venmo - Personal" }),
  ]);
  await db.insert(financialAccounts).values([
    makeAccount({ id: "chk", userId: U, plaidItemId: "pib", name: "Everyday Checking" }),
    makeAccount({ id: "wallet", userId: U, plaidItemId: "pia", name: "Personal Profile" }),
  ]);
  await db.insert(transactions).values([
    t("out", "wallet", "120.00", "2026-03-20", { name: "Standard transfer", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_ACCOUNT_TRANSFER" }),
    t("in", "chk", "-120.00", "2026-03-21", { name: "Venmo", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_TRANSFER_IN_FROM_APPS" }),
    t("deposit", "chk", "-80.00", "2026-03-10", { name: "Mobile Deposit", category: "TRANSFER_IN", categoryId: "TRANSFER_IN_DEPOSIT" }),
    t("odd", "chk", "190.00", "2026-03-11", { name: "ODD MERCHANT 12", category: "TRANSFER_OUT", categoryId: "TRANSFER_OUT_ACCOUNT_TRANSFER" }),
  ]);
  await postProcessTransactions(U, []);
});

describe("flow-class overrides", () => {
  it("starts paired", async () => {
    expect((await get("out")).transferPairId).toBeTruthy();
    expect((await get("in")).flowClass).toBe("internal_transfer");
  });

  it("a manual non-internal class on a paired row dissolves the pair; pairing never re-creates it", async () => {
    const res = await setManualFlowClass(U, "in", "reimbursement");
    expect(res).toMatchObject({ ok: true, flowClass: "reimbursement" });
    const [inn, out] = [await get("in"), await get("out")];
    expect(inn.flowClass).toBe("reimbursement");
    expect(inn.flowClassSource).toBe("manual");
    expect(inn.isRefund).toBe(true);
    expect(inn.transferPairId).toBeNull();
    expect(out.transferPairId).toBeNull();
    expect(out.flowClassSource).toBe("auto");

    await postProcessTransactions(U, []);
    expect((await get("in")).transferPairId).toBeNull();
    expect((await get("in")).flowClass).toBe("reimbursement");
  });

  it("rejects a class that does not fit the sign and an unknown row", async () => {
    expect(await setManualFlowClass(U, "deposit", "spending")).toEqual({ ok: false, error: "invalid_class" });
    expect(await setManualFlowClass(U, "nope", "income")).toEqual({ ok: false, error: "not_found" });
    expect(await setManualFlowClass("someone-else", "deposit", "income")).toEqual({ ok: false, error: "not_found" });
  });

  it("clearing an override returns the row to automatic classification", async () => {
    await setManualFlowClass(U, "deposit", "income");
    expect((await get("deposit")).flowClass).toBe("income");
    const res = await clearManualFlowClass(U, "deposit");
    expect(res).toMatchObject({ ok: true, flowClass: "other_inflow" });
    expect((await get("deposit")).flowClassSource).toBe("auto");
    expect((await get("deposit")).refundSource).toBeNull();
  });

  it("'not a transfer' unpairs both legs and pins them to their own classes", async () => {
    const res = await unpairTransfer(U, "out");
    expect(res.ok).toBe(true);
    const [out, inn] = [await get("out"), await get("in")];
    expect(out.transferPairId).toBeNull();
    expect(inn.transferPairId).toBeNull();
    expect(out.flowClassSource).toBe("manual");
    expect(inn.flowClassSource).toBe("manual");
    await postProcessTransactions(U, []);
    expect((await get("out")).transferPairId).toBeNull();
  });

  it("the refund toggle maps onto manual classes", async () => {
    await setManualFlowClass(U, "deposit", "refund");
    const row = await get("deposit");
    expect(row.flowClass).toBe("refund");
    expect(row.isRefund).toBe(true);
    expect(row.refundSource).toBe("manual");
    await setManualFlowClass(U, "deposit", "income");
    expect((await get("deposit")).isRefund).toBe(false);
  });

  it("a custom category edit reclassifies the row", async () => {
    expect((await get("odd")).flowClass).toBe("p2p_payment");
    await getTestDb().update(transactions).set({ customCategory: "GENERAL_MERCHANDISE" }).where(eq(transactions.id, "odd"));
    await recomputeUserFlowsLocked(U);
    expect((await get("odd")).flowClass).toBe("spending");
  });
});

describe("flow options", () => {
  it("client-safe labels mirror FLOW_CLASS_LABEL exactly", () => {
    expect(FLOW_CLASS_OPTION_LABEL).toEqual(FLOW_CLASS_LABEL);
  });
  it("offers sign-appropriate classes only", () => {
    expect(allowedFlowClasses("10")).toContain("spending");
    expect(allowedFlowClasses("10")).not.toContain("income");
    expect(allowedFlowClasses("-10")).toContain("reimbursement");
    expect(allowedFlowClasses("0")).toEqual([]);
  });
});
