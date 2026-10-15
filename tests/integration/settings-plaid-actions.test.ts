import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";
import { pagedSync, plaidAccount, plaidApiError, plaidTxn } from "../setup/plaid-fixtures";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";

const plaid = vi.hoisted(() => ({
  itemRemove: vi.fn(),
  transactionsSync: vi.fn(),
  transactionsRecurringGet: vi.fn(),
  accountsGet: vi.fn(),
}));
vi.mock("@/lib/plaid/client", () => ({ plaidClient: plaid }));
vi.mock("@/lib/utils/encryption", () => ({
  decrypt: (s: string) => `plain:${s}`,
  encrypt: (s: string) => s,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const session = vi.hoisted(() => ({ current: { user: { id: "u_set" } } as { user: { id: string } } | null }));
vi.mock("@/lib/auth/get-session", () => ({ getServerSession: async () => session.current }));
const postProcess = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/plaid/post-process", () => ({ postProcessTransactions: postProcess }));

import {
  syncPlaidItemAction,
  unlinkPlaidItemAction,
} from "@/app/(routes)/(dashboard)/settings/actions";

const U = "u_set";
const ITEM = "pi_set";
const OTHER_ITEM = "pi_set_other";

beforeEach(async () => {
  session.current = { user: { id: U } };
  for (const fn of Object.values(plaid)) fn.mockReset();
  postProcess.mockClear();
  const initial = { next_cursor: "c1", transactions_update_status: "INITIAL_UPDATE_COMPLETE" };
  plaid.transactionsSync.mockImplementation(
    pagedSync({ "": { ...initial, added: [plaidTxn("new_1", "pa_chk")] }, c1: initial }),
  );
  plaid.accountsGet.mockResolvedValue({ data: { accounts: [plaidAccount("pa_chk"), plaidAccount("pa_card")] } });
  plaid.transactionsRecurringGet.mockResolvedValue({
    data: { updated_datetime: "2026-04-30T00:00:00Z", inflow_streams: [], outflow_streams: [] },
  });
  plaid.itemRemove.mockResolvedValue({ data: { request_id: "r" } });

  const db = getTestDb();
  await db.insert(user).values([makeUser({ id: U }), makeUser({ id: "u_stranger" })]);
  await db.insert(plaidItems).values([
    makePlaidItem({ id: ITEM, userId: U, itemId: "item_set", accessToken: "enc_tok" }),
    makePlaidItem({ id: OTHER_ITEM, userId: U, itemId: "item_set_other" }),
  ]);
  await db.insert(financialAccounts).values([
    makeAccount({ id: "acc_chk", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_chk" }),
    makeAccount({ id: "acc_card", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_card" }),
    makeAccount({ id: "acc_other", userId: U, plaidItemId: OTHER_ITEM, plaidAccountId: "pa_other" }),
  ]);
});

async function seedItemData() {
  const db = getTestDb();
  await db.insert(recurringStreams).values({
    streamId: "st_rent",
    userId: U,
    plaidItemId: ITEM,
    accountId: "acc_chk",
    flowType: "outflow",
    description: "Rent",
    frequency: "MONTHLY",
    status: "MATURE",
    averageAmount: "1000",
    lastAmount: "1000",
  });
  await db.insert(transactions).values([
    makeTxn({ id: "t_rent", userId: U, accountId: "acc_chk", recurringStreamId: "st_rent", amount: "1000.00" }),
    makeTxn({ id: "t_xfer_out", userId: U, accountId: "acc_chk", amount: "50.00", transferPairId: "pair_x", isTransfer: true }),
    makeTxn({ id: "t_xfer_in", userId: U, accountId: "acc_other", amount: "-50.00", transferPairId: "pair_x", isTransfer: true }),
    makeTxn({ id: "t_keep", userId: U, accountId: "acc_other", amount: "7.00" }),
  ]);
}

describe("unlinkPlaidItemAction (audit 2.7)", () => {
  it("removes the item at Plaid first, then deletes streams, transactions, accounts and the item in one go", async () => {
    await seedItemData();
    const res = await unlinkPlaidItemAction(ITEM);
    expect(res).toEqual({ success: true });

    expect(plaid.itemRemove).toHaveBeenCalledWith({ access_token: "plain:enc_tok" });
    const db = getTestDb();
    expect(await db.select().from(plaidItems).where(eq(plaidItems.id, ITEM))).toHaveLength(0);
    expect(await db.select().from(financialAccounts).where(eq(financialAccounts.plaidItemId, ITEM))).toHaveLength(0);
    expect(await db.select().from(recurringStreams).where(eq(recurringStreams.plaidItemId, ITEM))).toHaveLength(0);
    const left = await db.select().from(transactions).where(eq(transactions.userId, U));
    expect(left.map((t) => t.id).sort()).toEqual(["t_keep", "t_xfer_in"]);
    // The surviving transfer leg on another item is unpaired and re-derived.
    expect(left.find((t) => t.id === "t_xfer_in")).toMatchObject({ transferPairId: null, isTransfer: false });
    expect(postProcess).toHaveBeenCalledWith(U, ["t_xfer_in"]);
    // Other item untouched.
    expect(await db.select().from(plaidItems).where(eq(plaidItems.id, OTHER_ITEM))).toHaveLength(1);
  });

  it("treats ITEM_NOT_FOUND at Plaid as already removed", async () => {
    plaid.itemRemove.mockRejectedValue(plaidApiError("ITEM_NOT_FOUND"));
    expect(await unlinkPlaidItemAction(ITEM)).toEqual({ success: true });
    expect(await getTestDb().select().from(plaidItems).where(eq(plaidItems.id, ITEM))).toHaveLength(0);
  });

  it("keeps everything (and releases the lease) when /item/remove fails otherwise", async () => {
    await seedItemData();
    plaid.itemRemove.mockRejectedValue(plaidApiError("INTERNAL_SERVER_ERROR", 500, "API_ERROR"));
    const res = await unlinkPlaidItemAction(ITEM);
    expect(res.success).toBe(false);
    const [row] = await getTestDb().select().from(plaidItems).where(eq(plaidItems.id, ITEM));
    expect(row).toMatchObject({ status: "active", syncLeaseUntil: null });
    expect(await getTestDb().select().from(transactions).where(eq(transactions.accountId, "acc_chk"))).toHaveLength(2);
  });

  it("validates input and ownership", async () => {
    expect(await unlinkPlaidItemAction(42)).toEqual({ success: false, error: "Invalid request" });
    expect(await unlinkPlaidItemAction("")).toEqual({ success: false, error: "Invalid request" });
    session.current = { user: { id: "u_stranger" } };
    expect(await unlinkPlaidItemAction(ITEM)).toEqual({ success: false, error: "Plaid item not found" });
    session.current = null;
    expect(await unlinkPlaidItemAction(ITEM)).toEqual({ success: false, error: "Unauthorized" });
    expect(plaid.itemRemove).not.toHaveBeenCalled();
  });

  it("refuses while a background sync holds the lease (never deletes under a running sync)", async () => {
    await getTestDb()
      .update(plaidItems)
      .set({ syncLeaseUntil: sql`now() + interval '5 minutes'` })
      .where(eq(plaidItems.id, ITEM));
    const { holdLeaseForRemoval } = await import("@/lib/plaid/jobs");
    expect(await holdLeaseForRemoval(ITEM, { waitMs: 50, pollMs: 10 })).toBe(false);
  });
});

describe("syncPlaidItemAction", () => {
  it("requests sync + recurring and drains through the lease", async () => {
    const res = await syncPlaidItemAction(ITEM);
    expect(res).toMatchObject({ success: true, data: { added: 1, modified: 0, removed: 0, inProgress: false } });
    expect(plaid.transactionsSync).toHaveBeenCalled();
    expect(plaid.transactionsRecurringGet).toHaveBeenCalledTimes(1);
    const [row] = await getTestDb().select().from(plaidItems).where(eq(plaidItems.id, ITEM));
    expect(row.syncLeaseUntil).toBeNull();
    expect(row.recurringFetchedAt).toBeInstanceOf(Date);
  });

  it("is not gated on attention, attempts a login_required item, and maps the Plaid error", async () => {
    await getTestDb()
      .update(plaidItems)
      .set({ status: "login_required", attention: "login_required" })
      .where(eq(plaidItems.id, ITEM));
    plaid.transactionsSync.mockRejectedValue(plaidApiError("ITEM_LOGIN_REQUIRED"));
    const res = await syncPlaidItemAction(ITEM);
    expect(res).toEqual({
      success: false,
      error: "Your bank connection needs to be re-authenticated. Please reconnect your account.",
    });

    // The item healed at the bank: the same button now succeeds and clears the prompt.
    plaid.transactionsSync.mockImplementation(pagedSync({ "": { next_cursor: "c1" }, c1: { next_cursor: "c1" } }));
    expect((await syncPlaidItemAction(ITEM)).success).toBe(true);
    const [row] = await getTestDb().select().from(plaidItems).where(eq(plaidItems.id, ITEM));
    expect(row).toMatchObject({ status: "active", attention: null });
  });

  it("refuses revoked items and invalid input", async () => {
    expect(await syncPlaidItemAction({ id: ITEM })).toEqual({ success: false, error: "Invalid request" });
    await getTestDb().update(plaidItems).set({ status: "revoked" }).where(eq(plaidItems.id, ITEM));
    expect((await syncPlaidItemAction(ITEM)).success).toBe(false);
    expect(plaid.transactionsSync).not.toHaveBeenCalled();
  });
});
