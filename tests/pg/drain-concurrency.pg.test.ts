/**
 * Lease + advisory-lock concurrency against a real Postgres (see
 * vitest.pg.config.ts). Synthetic rows only; everything created here is
 * deleted afterwards.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { makePlaidItem, makeUser, makeAccount } from "../setup/factories";
import { plaidAccount, plaidTxn, syncResponse } from "../setup/plaid-fixtures";

const url = process.env.TEST_PG_URL ?? "";
const isLocal = (() => {
  try {
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
})();
if (isLocal) process.env.DATABASE_URL = url; // app's db handle connects lazily

const plaid = vi.hoisted(() => ({
  transactionsSync: vi.fn(),
  accountsGet: vi.fn(),
  transactionsRecurringGet: vi.fn(),
}));
vi.mock("@/lib/plaid/client", () => ({ plaidClient: plaid }));
vi.mock("@/lib/utils/encryption", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { db } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { deletePlaidItemData, drainItem, drainItemSoon } from "@/lib/plaid/jobs";
import { CursorConflictError, syncTransactions } from "@/lib/plaid/sync";
import { requestItemSync } from "@/lib/plaid/sync-requests";

const RUN = `w1pg_${Date.now().toString(36)}`;
const U = `${RUN}_user`;
const ITEM = `${RUN}_item`;
const ACCOUNT = `${RUN}_acct`;
const PLAID_ACCOUNT = `${RUN}_pa`;
const N = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Slow /transactions/sync mock that records how many calls overlap. */
function instrumentedSync(delayMs: number) {
  const stats = { calls: 0, active: 0, maxActive: 0 };
  plaid.transactionsSync.mockImplementation(async (req: { cursor?: string }) => {
    stats.calls++;
    stats.active++;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    try {
      await sleep(delayMs);
      if (!req.cursor) {
        return syncResponse({
          accounts: [plaidAccount(PLAID_ACCOUNT)],
          added: Array.from({ length: N }, (_, i) =>
            plaidTxn(`${RUN}_t${i}`, PLAID_ACCOUNT, { amount: 1 + i }),
          ),
          next_cursor: "c1",
          transactions_update_status: "INITIAL_UPDATE_COMPLETE",
        });
      }
      return syncResponse({ next_cursor: req.cursor, transactions_update_status: "INITIAL_UPDATE_COMPLETE" });
    } finally {
      stats.active--;
    }
  });
  return stats;
}

async function resetItem() {
  await db.delete(transactions).where(eq(transactions.userId, U));
  await db
    .update(plaidItems)
    .set({
      cursor: null,
      syncRequestedAt: null,
      syncLeaseUntil: null,
      lastSyncStartedAt: null,
      lastSuccessfulSyncAt: null,
      status: "active",
    })
    .where(eq(plaidItems.id, ITEM));
}

async function seed() {
  await db.insert(user).values(makeUser({ id: U, email: `${U}@test.local` }));
  await db.insert(plaidItems).values(makePlaidItem({ id: ITEM, userId: U, itemId: `${RUN}_plaid`, accessToken: "tok" }));
  await db.insert(financialAccounts).values(
    makeAccount({ id: ACCOUNT, userId: U, plaidItemId: ITEM, plaidAccountId: PLAID_ACCOUNT }),
  );
}

async function rowCount() {
  const rows = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, U));
  return rows.length;
}

describe.skipIf(!isLocal)("sync concurrency on real Postgres", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    await db.delete(transactions).where(eq(transactions.userId, U));
    await db.delete(financialAccounts).where(eq(financialAccounts.userId, U));
    await db.delete(plaidItems).where(eq(plaidItems.userId, U));
    await db.delete(user).where(inArray(user.id, [U]));
  });

  beforeEach(async () => {
    for (const fn of Object.values(plaid)) fn.mockReset();
    plaid.accountsGet.mockResolvedValue({ data: { accounts: [plaidAccount(PLAID_ACCOUNT)] } });
    plaid.transactionsRecurringGet.mockResolvedValue({
      data: { updated_datetime: "2026-04-30T00:00:00Z", inflow_streams: [], outflow_streams: [] },
    });
    await resetItem();
  });

  it("five concurrent drains for one item: exactly one sync, never two at once", async () => {
    const stats = instrumentedSync(400);
    await requestItemSync(ITEM);

    const results = await Promise.all(Array.from({ length: 5 }, () => drainItem(ITEM)));

    const done = results.filter((r) => r.status === "done");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ runs: 1 });
    expect(results.filter((r) => r.status === "busy").length + results.filter((r) => r.status === "idle").length).toBe(4);
    expect(stats.calls).toBe(1);
    expect(stats.maxActive).toBe(1);
    expect(await rowCount()).toBe(N);
    const [row] = await db.select().from(plaidItems).where(eq(plaidItems.id, ITEM));
    expect(row.syncLeaseUntil).toBeNull();
  });

  it("a request that arrives mid-run is drained by the running worker, not concurrently", async () => {
    const stats = instrumentedSync(300);
    await requestItemSync(ITEM);
    const first = drainItem(ITEM);
    await sleep(100); // first drain is now inside /transactions/sync
    await requestItemSync(ITEM);
    const midRun = drainItem(ITEM);

    const [a, b] = await Promise.all([first, midRun]);
    expect(b).toEqual({ status: "busy" });
    expect(a).toMatchObject({ status: "done", runs: 2 });
    expect(stats.maxActive).toBe(1);
    expect(stats.calls).toBe(2);
  });

  it("three webhooks in a burst (drainItemSoon) collapse into one sync run", async () => {
    const stats = instrumentedSync(100);
    for (let i = 0; i < 3; i++) {
      await requestItemSync(ITEM);
      drainItemSoon(ITEM, { debounceMs: 300 });
    }
    await vi.waitFor(
      async () => {
        const [row] = await db.select().from(plaidItems).where(eq(plaidItems.id, ITEM));
        expect(row.lastSuccessfulSyncAt).toBeInstanceOf(Date);
        expect(row.syncLeaseUntil).toBeNull();
      },
      { timeout: 10_000, interval: 100 },
    );
    await sleep(500);
    expect(stats.calls).toBe(1);
  });

  it("concurrent syncs that bypass the lease: the cursor CAS lets exactly one apply", async () => {
    instrumentedSync(200);
    const settled = await Promise.allSettled([syncTransactions(ITEM), syncTransactions(ITEM), syncTransactions(ITEM)]);
    const ok = settled.filter((s) => s.status === "fulfilled");
    const conflicts = settled.filter(
      (s) => s.status === "rejected" && s.reason instanceof CursorConflictError,
    );
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(2);
    expect(await rowCount()).toBe(N);
  });

  it("the per-item advisory lock serialises writers across connections", async () => {
    instrumentedSync(0);
    const holder = postgres(url, { max: 1, prepare: false });
    try {
      let syncDone = 0;
      await holder.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"plaid-item:" + ITEM}, 0))`;
        const sync = syncTransactions(ITEM).then(() => (syncDone = Date.now()));
        await sleep(800);
        expect(syncDone).toBe(0); // blocked behind our lock
        void sync;
      });
      await vi.waitFor(() => expect(syncDone).toBeGreaterThan(0), { timeout: 5000 });
      expect(await rowCount()).toBe(N);
    } finally {
      await holder.end();
    }
  });

  it("unlink during a sync's Plaid fetch: the sync cannot re-insert anything afterwards", async () => {
    // Separate item so the shared fixture survives.
    const item2 = `${ITEM}_2`;
    const acct2 = `${ACCOUNT}_2`;
    await db.insert(plaidItems).values(makePlaidItem({ id: item2, userId: U, itemId: `${RUN}_plaid2`, accessToken: "tok" }));
    await db.insert(financialAccounts).values(makeAccount({ id: acct2, userId: U, plaidItemId: item2, plaidAccountId: PLAID_ACCOUNT + "_2" }));
    plaid.transactionsSync.mockImplementation(async () => {
      await sleep(400);
      return syncResponse({
        accounts: [plaidAccount(PLAID_ACCOUNT + "_2")],
        added: [plaidTxn(`${RUN}_late`, PLAID_ACCOUNT + "_2")],
        next_cursor: "c1",
      });
    });
    const sync = syncTransactions(item2).catch((e) => e);
    await sleep(100);
    const removed = await deletePlaidItemData(U, item2);
    expect(removed.deleted).toBe(true);
    expect(await sync).toBeInstanceOf(CursorConflictError);
    expect(await db.select().from(financialAccounts).where(eq(financialAccounts.plaidItemId, item2))).toHaveLength(0);
    expect(await db.select().from(transactions).where(eq(transactions.plaidTransactionId, `${RUN}_late`))).toHaveLength(0);
  });
});
