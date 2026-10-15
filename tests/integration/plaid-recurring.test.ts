import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { countStatements, getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeTxn, makeUser } from "../setup/factories";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { transactions } from "@/lib/db/schema/transactions";
import { recurringStreams } from "@/lib/db/schema/recurring";

const plaid = vi.hoisted(() => ({ transactionsRecurringGet: vi.fn() }));
vi.mock("@/lib/plaid/client", () => ({ plaidClient: plaid }));
vi.mock("@/lib/utils/encryption", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { fetchRecurringTransactions } from "@/lib/plaid/recurring";

const U = "u_rec";
const ITEM = "pi_rec";

function stream(id: string, accountId: string, txIds: string[], over: Record<string, unknown> = {}) {
  return {
    stream_id: id,
    account_id: accountId,
    description: `Stream ${id}`,
    merchant_name: "Streaming Service",
    frequency: "MONTHLY",
    status: "MATURE",
    is_active: true,
    first_date: "2026-03-01",
    last_date: "2026-04-01",
    predicted_next_date: "2026-05-01",
    average_amount: { amount: 15, iso_currency_code: "USD" },
    last_amount: { amount: 15, iso_currency_code: "USD" },
    personal_finance_category: null,
    transaction_ids: txIds,
    ...over,
  };
}

function respond(outflow: unknown[], inflow: unknown[] = []) {
  plaid.transactionsRecurringGet.mockResolvedValue({
    data: { updated_datetime: "2026-04-30T00:00:00Z", inflow_streams: inflow, outflow_streams: outflow },
  });
}

async function txn(id: string) {
  const [row] = await getTestDb().select().from(transactions).where(eq(transactions.id, id));
  return row;
}

async function xmin(id: string) {
  const res = await getTestDb().execute(sql`SELECT xmin::text AS x FROM transactions WHERE id = ${id}`);
  return (res as unknown as { rows: Array<{ x: string }> }).rows[0].x;
}

beforeEach(async () => {
  plaid.transactionsRecurringGet.mockReset();
  const db = getTestDb();
  await db.insert(user).values(makeUser({ id: U }));
  await db.insert(plaidItems).values(makePlaidItem({ id: ITEM, userId: U, itemId: "item_rec", accessToken: "tok" }));
  await db.insert(financialAccounts).values(
    makeAccount({ id: "acc_card", userId: U, plaidItemId: ITEM, plaidAccountId: "pa_card" }),
  );
  await db.insert(transactions).values([
    makeTxn({ id: "r1", userId: U, accountId: "acc_card", plaidTransactionId: "p1", amount: "15.00", date: new Date("2026-03-01T00:00:00Z"), merchantName: "Streaming Service" }),
    makeTxn({ id: "r2", userId: U, accountId: "acc_card", plaidTransactionId: "p2", amount: "15.00", date: new Date("2026-04-01T00:00:00Z"), merchantName: "Streaming Service", customName: "My own name" }),
    // An earlier occurrence Plaid left out of transaction_ids.
    makeTxn({ id: "r0", userId: U, accountId: "acc_card", plaidTransactionId: "p0", amount: "14.00", date: new Date("2026-02-01T00:00:00Z"), merchantName: "streaming service" }),
  ]);
});

describe("fetchRecurringTransactions (verify-plaid N2, N11)", () => {
  it("links stream transactions and orphans, skips unknown-account streams, records recurring_fetched_at", async () => {
    respond([stream("st_a", "pa_card", ["p1", "p2"]), stream("st_unknown", "pa_not_on_item", ["p9"])]);
    const res = await fetchRecurringTransactions(ITEM);
    expect(res).toMatchObject({ upserted: 1, linkedTransactions: 2, backfilledOrphans: 1, skippedStreams: 1 });
    expect((await txn("r1")).recurringStreamId).toBe("st_a");
    expect((await txn("r0")).recurringStreamId).toBe("st_a");
    const streams = await getTestDb().select().from(recurringStreams);
    expect(streams.map((s) => s.streamId)).toEqual(["st_a"]);
    const [item] = await getTestDb().select().from(plaidItems).where(eq(plaidItems.id, ITEM));
    expect(item.recurringFetchedAt).toBeInstanceOf(Date);
  });

  it("an unchanged refresh writes no transaction rows and costs a handful of statements", async () => {
    respond([stream("st_a", "pa_card", ["p1", "p2"])]);
    await fetchRecurringTransactions(ITEM);
    const before = [await xmin("r0"), await xmin("r1"), await xmin("r2")];

    const { result, statements } = await countStatements(() => fetchRecurringTransactions(ITEM));

    expect(result).toMatchObject({ linkedTransactions: 0, backfilledOrphans: 0 });
    expect([await xmin("r0"), await xmin("r1"), await xmin("r2")]).toEqual(before);
    expect(statements).toBeLessThanOrEqual(10);
  });

  it("newly linked rows inherit the stream's custom name; otherwise the row's own name stays", async () => {
    respond([stream("st_a", "pa_card", ["p1", "p2"])]);
    await getTestDb().insert(recurringStreams).values({
      streamId: "st_a",
      userId: U,
      plaidItemId: ITEM,
      accountId: "acc_card",
      flowType: "outflow",
      description: "x",
      frequency: "MONTHLY",
      status: "MATURE",
      averageAmount: "15",
      lastAmount: "15",
      customName: "Video subscription",
    });
    await fetchRecurringTransactions(ITEM);
    expect((await txn("r1")).customName).toBe("Video subscription");

    await getTestDb().update(recurringStreams).set({ customName: null }).where(eq(recurringStreams.streamId, "st_a"));
    await getTestDb().update(transactions).set({ recurringStreamId: null, customName: "My own name" }).where(eq(transactions.id, "r2"));
    await fetchRecurringTransactions(ITEM);
    expect((await txn("r2")).customName).toBe("My own name");
  });

  it("matches orphans of inflow streams with a negative average", async () => {
    await getTestDb().insert(transactions).values([
      makeTxn({ id: "pay1", userId: U, accountId: "acc_card", plaidTransactionId: "pp1", amount: "-2000.00", date: new Date("2026-04-01T00:00:00Z"), merchantName: "Employer Inc" }),
      makeTxn({ id: "pay0", userId: U, accountId: "acc_card", plaidTransactionId: "pp0", amount: "-1950.00", date: new Date("2026-03-01T00:00:00Z"), merchantName: "Employer Inc" }),
    ]);
    respond([], [
      stream("st_pay", "pa_card", ["pp1"], {
        merchant_name: "Employer Inc",
        first_date: "2026-04-01",
        average_amount: { amount: -2000, iso_currency_code: "USD" },
        last_amount: { amount: -2000, iso_currency_code: "USD" },
      }),
    ]);
    const res = await fetchRecurringTransactions(ITEM);
    expect(res.backfilledOrphans).toBe(1);
    expect((await txn("pay0")).recurringStreamId).toBe("st_pay");
  });

  it("classifies only rows whose stream changed", async () => {
    respond([stream("st_a", "pa_card", ["p1"])]);
    await fetchRecurringTransactions(ITEM);
    await getTestDb().update(recurringStreams).set({ spendingType: "necessary" }).where(eq(recurringStreams.streamId, "st_a"));
    respond([stream("st_a", "pa_card", ["p1", "p2"])]);
    await fetchRecurringTransactions(ITEM);
    // r2 newly linked -> classified from the stream; r1 (unchanged link) untouched.
    expect(await txn("r2")).toMatchObject({ spendingType: "necessary", spendingTypeSource: "stream" });
    expect((await txn("r1")).spendingType).toBeNull();
  });
});
