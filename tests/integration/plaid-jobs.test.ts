import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeUser } from "../setup/factories";
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

const plaid = vi.hoisted(() => ({
  transactionsSync: vi.fn(),
  transactionsRecurringGet: vi.fn(),
  accountsGet: vi.fn(),
}));
vi.mock("@/lib/plaid/client", () => ({ plaidClient: plaid }));
vi.mock("@/lib/utils/encryption", () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));
vi.mock("@/lib/plaid/post-process", () => ({ postProcessTransactions: vi.fn(async () => undefined) }));

import { drainItem, drainItemSoon, sweepPlaidItems } from "@/lib/plaid/jobs";
import { requestItemSync } from "@/lib/plaid/sync-requests";

const U = "u_jobs";
const ITEM = "pi_jobs";
const accounts = [plaidAccount("pa_chk")];

function recurringResponse() {
  return {
    data: { updated_datetime: "2026-04-30T00:00:00Z", inflow_streams: [], outflow_streams: [] },
  };
}

async function item() {
  const [row] = await getTestDb().select().from(plaidItems).where(eq(plaidItems.id, ITEM));
  return row;
}

beforeEach(async () => {
  const db = getTestDb();
  for (const fn of Object.values(plaid)) fn.mockReset();
  const initial = { next_cursor: "c1", transactions_update_status: "INITIAL_UPDATE_COMPLETE" };
  plaid.transactionsSync.mockImplementation(pagedSync({ "": initial, c1: initial }));
  plaid.accountsGet.mockResolvedValue({ data: { accounts } });
  plaid.transactionsRecurringGet.mockResolvedValue(recurringResponse());
  await db.insert(user).values(makeUser({ id: U }));
  await db.insert(plaidItems).values(makePlaidItem({ id: ITEM, userId: U, itemId: "item_jobs", accessToken: "tok" }));
  await db.insert(financialAccounts).values(
    makeAccount({ id: "acc_chk", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_chk" }),
  );
});

describe("drainItem", () => {
  it("does nothing without a pending request", async () => {
    expect(await drainItem(ITEM)).toEqual({ status: "idle" });
    expect(plaid.transactionsSync).not.toHaveBeenCalled();
  });

  it("runs sync + balance refresh once for a request, records success and releases the lease", async () => {
    await requestItemSync(ITEM);
    const res = await drainItem(ITEM);
    expect(res).toMatchObject({ status: "done", runs: 1, recurringFetched: false, errorCode: null });
    expect(plaid.transactionsSync).toHaveBeenCalledTimes(1);
    expect(plaid.accountsGet).toHaveBeenCalledTimes(1);
    expect(plaid.transactionsRecurringGet).not.toHaveBeenCalled();
    const row = await item();
    expect(row.syncLeaseUntil).toBeNull();
    expect(row.lastSuccessfulSyncAt).toBeInstanceOf(Date);
    expect(row.lastSyncStartedAt).toBeInstanceOf(Date);
    // Draining again: nothing pending.
    expect(await drainItem(ITEM)).toEqual({ status: "idle" });
  });

  it("returns busy while another worker holds the lease, and never syncs concurrently", async () => {
    await requestItemSync(ITEM);
    await getTestDb()
      .update(plaidItems)
      .set({ syncLeaseUntil: sql`now() + interval '5 minutes'` })
      .where(eq(plaidItems.id, ITEM));
    expect(await drainItem(ITEM)).toEqual({ status: "busy" });
    expect(plaid.transactionsSync).not.toHaveBeenCalled();
  });

  it("two overlapping drains: the second is busy, the first picks up its request", async () => {
    await requestItemSync(ITEM);
    let second: Awaited<ReturnType<typeof drainItem>> | undefined;
    let syncCalls = 0;
    plaid.transactionsSync.mockImplementation(async () => {
      syncCalls++;
      if (syncCalls === 1) {
        // A webhook arrives mid-run: it stamps a request and starts a drain.
        await requestItemSync(ITEM);
        second = await drainItem(ITEM);
      }
      return syncResponse({ next_cursor: "c1" });
    });
    const first = await drainItem(ITEM);
    expect(second).toEqual({ status: "busy" });
    expect(first).toMatchObject({ status: "done", runs: 2 });
    expect(syncCalls).toBe(2);
  });

  it("re-claims an expired lease (a run that died mid-way)", async () => {
    await getTestDb()
      .update(plaidItems)
      .set({
        syncRequestedAt: sql`now() - interval '20 minutes'`,
        lastSyncStartedAt: sql`now() - interval '15 minutes'`,
        syncLeaseUntil: sql`now() - interval '5 minutes'`,
      })
      .where(eq(plaidItems.id, ITEM));
    expect(await drainItem(ITEM)).toMatchObject({ status: "done", runs: 1 });
    expect((await item()).syncLeaseUntil).toBeNull();
  });

  it("fetches recurring when requested (RECURRING_TRANSACTIONS_UPDATE / manual) and records recurring_fetched_at", async () => {
    await requestItemSync(ITEM, { recurring: true });
    const res = await drainItem(ITEM);
    expect(res).toMatchObject({ status: "done", recurringFetched: true });
    expect(plaid.transactionsRecurringGet).toHaveBeenCalledTimes(1);
    expect((await item()).recurringFetchedAt).toBeInstanceOf(Date);

    // A later plain SYNC request does not refetch recurring (verify-plaid N11).
    await requestItemSync(ITEM);
    await drainItem(ITEM);
    expect(plaid.transactionsRecurringGet).toHaveBeenCalledTimes(1);
  });

  it("fetches recurring once after the historical pull completes, then never again on plain syncs", async () => {
    plaid.transactionsSync.mockImplementation(
      pagedSync({ "": { next_cursor: "c1", transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" }, c1: { next_cursor: "c1", transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" } }),
    );
    await requestItemSync(ITEM);
    await drainItem(ITEM);
    expect(plaid.transactionsRecurringGet).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      await requestItemSync(ITEM);
      await drainItem(ITEM);
    }
    expect(plaid.transactionsRecurringGet).toHaveBeenCalledTimes(1);
  });

  it("a failed recurring fetch (not ready) does not fail the sync and is retried with the next sync", async () => {
    plaid.transactionsRecurringGet.mockRejectedValueOnce(plaidApiError("PRODUCT_NOT_READY", 400, "ITEM_ERROR"));
    await requestItemSync(ITEM, { recurring: true });
    const res = await drainItem(ITEM);
    expect(res).toMatchObject({ status: "done", runs: 1, recurringFetched: false, errorCode: null });
    expect((await item()).recurringFetchedAt).toBeNull();
    await requestItemSync(ITEM);
    expect(await drainItem(ITEM)).toMatchObject({ recurringFetched: true });
  });

  it("maps ITEM_LOGIN_REQUIRED to status + attention, releases the lease, and does not loop", async () => {
    plaid.transactionsSync.mockRejectedValue(plaidApiError("ITEM_LOGIN_REQUIRED"));
    await requestItemSync(ITEM);
    const res = await drainItem(ITEM);
    expect(res).toMatchObject({ status: "done", runs: 1, errorCode: "ITEM_LOGIN_REQUIRED" });
    expect(plaid.transactionsSync).toHaveBeenCalledTimes(1);
    expect(await item()).toMatchObject({
      status: "login_required",
      attention: "login_required",
      lastSyncErrorCode: "ITEM_LOGIN_REQUIRED",
      syncLeaseUntil: null,
    });
  });

  it("records a transient failure code without changing status", async () => {
    plaid.transactionsSync.mockRejectedValue(plaidApiError("INSTITUTION_DOWN", 400, "INSTITUTION_ERROR"));
    await requestItemSync(ITEM);
    await drainItem(ITEM);
    expect(await item()).toMatchObject({ status: "active", lastSyncErrorCode: "INSTITUTION_DOWN" });
  });

  it("maps ITEM_NOT_FOUND to revoked; a revoked item is never claimed again", async () => {
    plaid.transactionsSync.mockRejectedValue(plaidApiError("ITEM_NOT_FOUND", 400, "ITEM_ERROR"));
    await requestItemSync(ITEM);
    await drainItem(ITEM);
    expect(await item()).toMatchObject({ status: "revoked", attention: "revoked", lastSyncErrorCode: "ITEM_NOT_FOUND" });
    await requestItemSync(ITEM);
    expect(await drainItem(ITEM)).toEqual({ status: "idle" });
    expect(plaid.transactionsSync).toHaveBeenCalledTimes(1);
  });
});

describe("drainItemSoon", () => {
  it("runs the drain in the background when called outside a request", async () => {
    await requestItemSync(ITEM);
    drainItemSoon(ITEM, { debounceMs: 0 });
    await vi.waitFor(async () => expect((await item()).lastSuccessfulSyncAt).toBeInstanceOf(Date));
  });
});

describe("sweepPlaidItems", () => {
  it("requests a sync for active items without a successful sync in 24 h and drains pending items", async () => {
    const db = getTestDb();
    await db.insert(plaidItems).values([
      makePlaidItem({ id: "pi_fresh", userId: U, itemId: "item_fresh", accessToken: "tok" }),
      makePlaidItem({ id: "pi_revoked", userId: U, itemId: "item_revoked", accessToken: "tok", status: "revoked" }),
    ]);
    await db
      .update(plaidItems)
      .set({ lastSuccessfulSyncAt: sql`now() - interval '1 hour'` })
      .where(eq(plaidItems.id, "pi_fresh"));

    const res = await sweepPlaidItems();

    expect(res).toEqual({ requested: 1, drained: 1 });
    expect((await item()).lastSuccessfulSyncAt).toBeInstanceOf(Date);
    const [revoked] = await db.select().from(plaidItems).where(eq(plaidItems.id, "pi_revoked"));
    expect(revoked.syncRequestedAt).toBeNull();
    // Nothing left to do on the next tick.
    expect(await sweepPlaidItems()).toEqual({ requested: 0, drained: 0 });
  });

  it("does not hammer an item that keeps failing", async () => {
    plaid.transactionsSync.mockRejectedValue(plaidApiError("INSTITUTION_DOWN", 400, "INSTITUTION_ERROR"));
    await sweepPlaidItems();
    await sweepPlaidItems();
    expect(plaid.transactionsSync).toHaveBeenCalledTimes(1);
  });
});
