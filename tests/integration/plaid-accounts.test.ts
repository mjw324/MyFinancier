import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AccountBase } from "plaid";
import { getTestDb, getTestExecutor } from "../setup/pglite";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { upsertPlaidAccounts } from "@/lib/plaid/accounts";
import { makeAccount, makePlaidItem, makeUser } from "../setup/factories";

function plaidAccount(id: string, over: Partial<AccountBase> = {}): AccountBase {
  return {
    account_id: id,
    name: `Account ${id}`,
    official_name: null,
    mask: "1234",
    type: "depository",
    subtype: "checking",
    balances: { current: 100.5, available: 90.25, limit: null, iso_currency_code: "USD", unofficial_currency_code: null },
    ...over,
  } as AccountBase;
}

beforeEach(async () => {
  const db = getTestDb();
  await db.insert(user).values([
    makeUser({ id: "u1", email: "u1@test.local" }),
    makeUser({ id: "u2", email: "u2@test.local" }),
  ]);
  await db.insert(plaidItems).values([
    makePlaidItem({ id: "i1", userId: "u1", itemId: "item1" }),
    makePlaidItem({ id: "i2", userId: "u2", itemId: "item2" }),
  ]);
});

describe("upsertPlaidAccounts", () => {
  it("inserts new accounts with mask, limit and balances", async () => {
    const db = getTestDb();
    const res = await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [
      plaidAccount("pa1"),
      plaidAccount("pa2", { type: "credit" as AccountBase["type"], balances: { current: 300, available: 4700, limit: 5000, iso_currency_code: "USD", unofficial_currency_code: null } }),
    ], { authoritative: true });
    expect(res).toEqual({ upserted: 2, closed: 0, conflicts: [] });
    const card = await db.query.financialAccounts.findFirst({ where: eq(financialAccounts.plaidAccountId, "pa2") });
    expect(card).toMatchObject({ mask: "1234", creditLimit: "5000", currentBalance: "300", closedAt: null });
  });

  it("refreshes balances of existing accounts in place", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values(makeAccount({ id: "a1", userId: "u1", plaidItemId: "i1", plaidAccountId: "pa1", currentBalance: "1.00" }));
    await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [plaidAccount("pa1")], { authoritative: false });
    const row = await db.query.financialAccounts.findFirst({ where: eq(financialAccounts.id, "a1") });
    expect(row?.currentBalance).toBe("100.5");
  });

  it("never reassigns another user's account (reports a conflict)", async () => {
    const db = getTestDb();
    await db.insert(financialAccounts).values(makeAccount({ id: "victim", userId: "u2", plaidItemId: "i2", plaidAccountId: "pa_shared", currentBalance: "777.00" }));
    const res = await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [plaidAccount("pa_shared")], { authoritative: false });
    expect(res.conflicts).toEqual(["pa_shared"]);
    const row = await db.query.financialAccounts.findFirst({ where: eq(financialAccounts.id, "victim") });
    expect(row).toMatchObject({ userId: "u2", plaidItemId: "i2", currentBalance: "777.00" });
  });

  it("closes accounts missing from an authoritative list and reopens them when they return", async () => {
    const db = getTestDb();
    await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [plaidAccount("pa1"), plaidAccount("pa2")], { authoritative: true });
    const r1 = await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [plaidAccount("pa1")], { authoritative: true });
    expect(r1.closed).toBe(1);
    let pa2 = await db.query.financialAccounts.findFirst({ where: eq(financialAccounts.plaidAccountId, "pa2") });
    expect(pa2?.closedAt).toBeInstanceOf(Date);
    await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [plaidAccount("pa1"), plaidAccount("pa2")], { authoritative: true });
    pa2 = await db.query.financialAccounts.findFirst({ where: eq(financialAccounts.plaidAccountId, "pa2") });
    expect(pa2?.closedAt).toBeNull();
  });

  it("does not close anything from a non-authoritative (sync) list or an empty list", async () => {
    const db = getTestDb();
    await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [plaidAccount("pa1"), plaidAccount("pa2")], { authoritative: true });
    expect((await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [plaidAccount("pa1")], { authoritative: false })).closed).toBe(0);
    expect((await upsertPlaidAccounts(getTestExecutor(), { id: "i1", userId: "u1" }, [], { authoritative: true })).closed).toBe(0);
  });
});
