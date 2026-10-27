import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";
import {
  pagedSync,
  plaidAccount,
  plaidApiError,
  plaidTxn,
  syncResponse,
} from "../setup/plaid-fixtures";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";

const plaid = vi.hoisted(() => ({ transactionsSync: vi.fn() }));
vi.mock("@/lib/plaid/client", () => ({ plaidClient: plaid }));
vi.mock("@/lib/utils/encryption", () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));
const postProcess = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/plaid/post-process", () => ({ postProcessTransactions: postProcess }));

import { CursorConflictError, syncTransactions } from "@/lib/plaid/sync";

const U = "u_sync";
const ITEM = "pi_sync";

async function txnByPlaidId(plaidTransactionId: string) {
  const [row] = await getTestDb()
    .select()
    .from(transactions)
    .where(eq(transactions.plaidTransactionId, plaidTransactionId));
  return row;
}

async function item() {
  const [row] = await getTestDb().select().from(plaidItems).where(eq(plaidItems.id, ITEM));
  return row;
}

beforeEach(async () => {
  const db = getTestDb();
  plaid.transactionsSync.mockReset();
  postProcess.mockClear();
  await db.insert(user).values([makeUser({ id: U }), makeUser({ id: "u_other" })]);
  await db.insert(plaidItems).values([
    makePlaidItem({ id: ITEM, userId: U, itemId: "item_sync", accessToken: "tok", cursor: null }),
    makePlaidItem({ id: "pi_other", userId: "u_other", itemId: "item_other" }),
  ]);
});

describe("syncTransactions — accounts across pages (verify-plaid N3, N13)", () => {
  it("unions accounts from every page so no page's transactions are dropped", async () => {
    plaid.transactionsSync.mockImplementation(
      pagedSync({
        "": {
          accounts: [plaidAccount("pa_one")],
          added: [plaidTxn("t1", "pa_one"), plaidTxn("t2", "pa_one")],
          next_cursor: "c1",
          has_more: true,
        },
        c1: {
          accounts: [plaidAccount("pa_two", { type: "credit" as never })],
          added: [plaidTxn("t3", "pa_two")],
          next_cursor: "c2",
          has_more: false,
        },
      }),
    );

    const res = await syncTransactions(ITEM);

    expect(res.added).toBe(3);
    expect(res.skipped).toBe(0);
    const accounts = await getTestDb()
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.plaidItemId, ITEM));
    expect(accounts.map((a) => a.plaidAccountId).sort()).toEqual(["pa_one", "pa_two"]);
    for (const id of ["t1", "t2", "t3"]) expect(await txnByPlaidId(id)).toBeDefined();
    expect((await item()).cursor).toBe("c2");
  });

  it("requests PFC v2 and stores the category confidence level", async () => {
    plaid.transactionsSync.mockImplementation(
      pagedSync({
        "": {
          accounts: [plaidAccount("pa_one")],
          added: [plaidTxn("t1", "pa_one")],
          next_cursor: "c1",
          has_more: false,
        },
      }),
    );

    await syncTransactions(ITEM);

    expect(plaid.transactionsSync.mock.calls[0][0].options).toMatchObject({
      personal_finance_category_version: "v2",
    });
    expect((await txnByPlaidId("t1")).pfcConfidenceLevel).toBe("HIGH");
  });

  it("upserts an account already inserted by a concurrent path instead of failing, and never reassigns another item's account", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({ id: "acc_mine", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_mine", currentBalance: "1.00" }),
      makeAccount({ id: "acc_theirs", userId: "u_other", plaidItemId: "pi_other", plaidAccountId: "pa_theirs", currentBalance: "777.00" }),
    ]);
    plaid.transactionsSync.mockImplementation(
      pagedSync({
        "": {
          accounts: [plaidAccount("pa_mine"), plaidAccount("pa_theirs")],
          added: [plaidTxn("tm", "pa_mine"), plaidTxn("tt", "pa_theirs")],
          next_cursor: "c1",
        },
      }),
    );

    const res = await syncTransactions(ITEM);

    expect(res.skipped).toBe(1);
    const theirs = await db.query.financialAccounts.findFirst({ where: eq(financialAccounts.id, "acc_theirs") });
    expect(theirs).toMatchObject({ userId: "u_other", plaidItemId: "pi_other", currentBalance: "777.00" });
    const mine = await db.query.financialAccounts.findFirst({ where: eq(financialAccounts.id, "acc_mine") });
    expect(mine?.currentBalance).toBe("100");
    expect(await txnByPlaidId("tm")).toBeDefined();
    expect(await txnByPlaidId("tt")).toBeUndefined();
  });
});

describe("syncTransactions — pending→posted carry-over (audit 2.4)", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values([
      makeAccount({ id: "acc_chk", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_chk" }),
      makeAccount({ id: "acc_sav", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_sav" }),
    ]);
    await db.insert(recurringStreams).values({
      streamId: "st_coffee",
      userId: U,
      plaidItemId: ITEM,
      accountId: "acc_chk",
      flowType: "outflow",
      description: "Coffee Shop",
      frequency: "WEEKLY",
      status: "MATURE",
      averageAmount: "12.50",
      lastAmount: "12.50",
    });
    // A pending row from an EARLIER sync, customised by the user.
    await db.insert(transactions).values([
      makeTxn({
        id: "row_pending",
        userId: U,
        accountId: "acc_chk",
        plaidTransactionId: "pend_1",
        amount: "12.00",
        pending: true,
        customName: "Morning coffee",
        customCategory: "Treats",
        spendingType: "discretionary",
        spendingTypeSource: "manual",
        flowClass: "spending",
        flowClassSource: "manual",
        recurringStreamId: "st_coffee",
        transferPairId: "pair_1",
        isTransfer: true,
      }),
      makeTxn({
        id: "row_partner",
        userId: U,
        accountId: "acc_sav",
        plaidTransactionId: "partner_1",
        amount: "-12.00",
        transferPairId: "pair_1",
        isTransfer: true,
      }),
    ]);
    await db.update(plaidItems).set({ cursor: "c0" }).where(eq(plaidItems.id, ITEM));
  });

  it("re-keys the pending row in place: id, custom fields, manual classes, stream and pair survive", async () => {
    plaid.transactionsSync.mockImplementation(
      pagedSync({
        c0: {
          added: [
            plaidTxn("post_1", "pa_chk", {
              amount: 12.5,
              pending: false,
              pending_transaction_id: "pend_1",
              date: "2026-04-16",
              authorized_date: "2026-04-15",
            }),
          ],
          removed: ["pend_1"],
          next_cursor: "c1",
        },
      }),
    );

    await syncTransactions(ITEM);

    expect(await txnByPlaidId("pend_1")).toBeUndefined();
    const posted = await txnByPlaidId("post_1");
    expect(posted).toMatchObject({
      id: "row_pending",
      amount: "12.5",
      pending: false,
      customName: "Morning coffee",
      customCategory: "Treats",
      spendingType: "discretionary",
      spendingTypeSource: "manual",
      flowClass: "spending",
      flowClassSource: "manual",
      recurringStreamId: "st_coffee",
      transferPairId: "pair_1",
      pendingTransactionId: "pend_1",
    });
    expect(posted.date.toISOString()).toBe("2026-04-16T00:00:00.000Z");
    expect(posted.authorizedDate?.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    // Partner still paired with the same row.
    expect((await txnByPlaidId("partner_1")).transferPairId).toBe("pair_1");
    const all = await getTestDb().select().from(transactions).where(eq(transactions.userId, U));
    expect(all).toHaveLength(2);
    expect(postProcess).toHaveBeenCalledTimes(1);
    expect(postProcess.mock.calls[0]).toEqual([U, ["row_pending"]]);
  });

  it("works when the posted row and the removal arrive on different pages", async () => {
    plaid.transactionsSync.mockImplementation(
      pagedSync({
        c0: { removed: ["pend_1"], next_cursor: "c0b", has_more: true },
        c0b: {
          added: [plaidTxn("post_1", "pa_chk", { pending_transaction_id: "pend_1" })],
          next_cursor: "c1",
        },
      }),
    );
    await syncTransactions(ITEM);
    expect((await txnByPlaidId("post_1"))?.id).toBe("row_pending");
  });

  it("a removed row with no successor unpairs its partner and clears the pair-derived transfer flag", async () => {
    const db = getTestDb();
    await db.insert(transactions).values(
      makeTxn({
        id: "row_manual_partner",
        userId: U,
        accountId: "acc_sav",
        plaidTransactionId: "partner_2",
        amount: "-5.00",
        transferPairId: "pair_2",
        isTransfer: true,
        flowClass: "internal_transfer",
        flowClassSource: "manual",
      }),
      // the other leg of pair_2, about to disappear
    );
    await db.insert(transactions).values(
      makeTxn({ id: "row_gone", userId: U, accountId: "acc_chk", plaidTransactionId: "gone_2", amount: "5.00", transferPairId: "pair_2", isTransfer: true }),
    );
    await db
      .update(transactions)
      .set({ flowClass: "internal_transfer", flowClassSource: "auto" })
      .where(eq(transactions.id, "row_partner"));
    plaid.transactionsSync.mockImplementation(
      pagedSync({ c0: { removed: ["pend_1", "gone_2"], next_cursor: "c1" } }),
    );

    await syncTransactions(ITEM);

    expect(await txnByPlaidId("pend_1")).toBeUndefined();
    const partner = await txnByPlaidId("partner_1");
    expect(partner).toMatchObject({ transferPairId: null, isTransfer: false, flowClass: null, flowClassSource: null });
    // A manual flow class keeps its class and flags; only the dangling pair id goes.
    const manual = await txnByPlaidId("partner_2");
    expect(manual).toMatchObject({ transferPairId: null, isTransfer: true, flowClass: "internal_transfer", flowClassSource: "manual" });
    expect(postProcess).toHaveBeenCalledTimes(1);
    expect([...(postProcess.mock.calls[0] as unknown as [string, string[]])[1]].sort()).toEqual(
      ["row_manual_partner", "row_partner"],
    );
  });

  it("keeps is_transfer when the partner's own Plaid category is a transfer", async () => {
    await getTestDb()
      .update(transactions)
      .set({ category: "TRANSFER_IN" })
      .where(eq(transactions.id, "row_partner"));
    plaid.transactionsSync.mockImplementation(pagedSync({ c0: { removed: ["pend_1"], next_cursor: "c1" } }));
    await syncTransactions(ITEM);
    expect(await txnByPlaidId("partner_1")).toMatchObject({ transferPairId: null, isTransfer: true });
  });
});

describe("syncTransactions — cursor compare-and-set (verify-plaid §3)", () => {
  it("aborts and writes nothing when the cursor moved while pages were being fetched", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values(
      makeAccount({ id: "acc_chk", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_chk" }),
    );
    plaid.transactionsSync.mockImplementation(async () => {
      // Another worker applies the same update while we are talking to Plaid.
      await db.update(plaidItems).set({ cursor: "c_other" }).where(eq(plaidItems.id, ITEM));
      return syncResponse({ added: [plaidTxn("t_dup", "pa_chk")], next_cursor: "c1" });
    });

    await expect(syncTransactions(ITEM)).rejects.toBeInstanceOf(CursorConflictError);

    expect(await txnByPlaidId("t_dup")).toBeUndefined();
    const row = await item();
    expect(row.cursor).toBe("c_other");
    expect(row.lastSuccessfulSyncAt).toBeNull();
    expect(postProcess).not.toHaveBeenCalled();
  });
});

describe("syncTransactions — Plaid failures", () => {
  beforeEach(async () => {
    await getTestDb().insert(financialAccounts).values(
      makeAccount({ id: "acc_chk", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_chk" }),
    );
  });

  it("restarts pagination from the first cursor after TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", async () => {
    let calls = 0;
    plaid.transactionsSync.mockImplementation(async (req: { cursor?: string }) => {
      calls++;
      if (calls === 2) throw plaidApiError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", 400, "TRANSACTIONS_ERROR");
      if (!req.cursor) {
        return syncResponse({ added: [plaidTxn(`first_${calls}`, "pa_chk")], next_cursor: "p2", has_more: true });
      }
      return syncResponse({ added: [plaidTxn("second", "pa_chk")], next_cursor: "done" });
    });

    const res = await syncTransactions(ITEM);

    // The first attempt's page is discarded; only the restart's pages apply.
    expect(res.added).toBe(2);
    expect(await txnByPlaidId("first_1")).toBeUndefined();
    expect(await txnByPlaidId("first_3")).toBeDefined();
    expect((await item()).cursor).toBe("done");
  });

  it("gives up after a bounded number of pagination restarts", async () => {
    plaid.transactionsSync.mockRejectedValue(
      plaidApiError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", 400, "TRANSACTIONS_ERROR"),
    );
    await expect(syncTransactions(ITEM)).rejects.toMatchObject({
      response: { data: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" } },
    });
    expect(plaid.transactionsSync).toHaveBeenCalledTimes(6);
  });

  it("retries a transient Plaid 5xx", async () => {
    plaid.transactionsSync
      .mockRejectedValueOnce(plaidApiError("INTERNAL_SERVER_ERROR", 500, "API_ERROR"))
      .mockResolvedValueOnce(syncResponse({ added: [plaidTxn("t_ok", "pa_chk")], next_cursor: "c1" }));
    await syncTransactions(ITEM);
    expect(await txnByPlaidId("t_ok")).toBeDefined();
  });

  it("does not retry an item error", async () => {
    plaid.transactionsSync.mockRejectedValue(plaidApiError("ITEM_LOGIN_REQUIRED"));
    await expect(syncTransactions(ITEM)).rejects.toBeTruthy();
    expect(plaid.transactionsSync).toHaveBeenCalledTimes(1);
  });
});

describe("syncTransactions — item state", () => {
  beforeEach(async () => {
    await getTestDb().insert(financialAccounts).values(
      makeAccount({ id: "acc_chk", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_chk" }),
    );
  });

  it("records success, heals login_required, stamps historical completion once, and post-processes once", async () => {
    const db = getTestDb();
    await db
      .update(plaidItems)
      .set({ status: "login_required", attention: "login_required", lastSyncErrorCode: "ITEM_LOGIN_REQUIRED" })
      .where(eq(plaidItems.id, ITEM));
    plaid.transactionsSync.mockImplementation(
      pagedSync({ "": { added: [plaidTxn("t1", "pa_chk")], next_cursor: "c1", transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" } }),
    );

    const res = await syncTransactions(ITEM);

    const row = await item();
    expect(res.historicalComplete).toBe(true);
    expect(row).toMatchObject({ status: "active", attention: null, lastSyncErrorCode: null, cursor: "c1" });
    expect(row.lastSuccessfulSyncAt).toBeInstanceOf(Date);
    expect(row.historicalUpdateCompleteAt).toBeInstanceOf(Date);
    expect(postProcess).toHaveBeenCalledTimes(1);
  });

  it("does not gate on pending_disconnect attention, but refuses a revoked item", async () => {
    const db = getTestDb();
    await db.update(plaidItems).set({ attention: "pending_disconnect" }).where(eq(plaidItems.id, ITEM));
    plaid.transactionsSync.mockImplementation(pagedSync({ "": { next_cursor: "c1" } }));
    await syncTransactions(ITEM);
    expect((await item()).attention).toBe("pending_disconnect");

    await db.update(plaidItems).set({ status: "revoked" }).where(eq(plaidItems.id, ITEM));
    await expect(syncTransactions(ITEM)).rejects.toThrow(/revoked/);
  });
});
