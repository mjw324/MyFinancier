/**
 * Linking lifecycle: duplicate detection before exchange, server-side
 * institution/accounts, race safety, update-mode completion, ownership.
 * Plaid is mocked (no network); the DB is PGlite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { AccountBase } from "plaid";

const mocks = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = "ab".repeat(32);
  return {
    session: { current: null as null | { user: { id: string } } },
    plaid: {
      itemPublicTokenExchange: vi.fn(),
      itemGet: vi.fn(),
      accountsGet: vi.fn(),
      itemRemove: vi.fn(),
      linkTokenCreate: vi.fn(),
      institutionsGetById: vi.fn(),
    },
  };
});

vi.mock("@/lib/plaid/client", () => ({ plaidClient: mocks.plaid }));
vi.mock("@/lib/auth/get-session", () => ({
  getServerSession: vi.fn(async () => mocks.session.current),
}));

import { getTestDb } from "../setup/pglite";
import { makeAccount, makePlaidItem, makeUser } from "../setup/factories";
import { user } from "@/lib/db/schema/auth";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { decrypt, encrypt } from "@/lib/utils/encryption";
import { POST as exchangeToken } from "@/app/api/plaid/exchange-token/route";
import { POST as createLinkTokenRoute } from "@/app/api/plaid/create-link-token/route";
import { POST as updateComplete } from "@/app/api/plaid/update-complete/route";

// --- helpers ----------------------------------------------------------------

async function call(
  handler: (req: Request) => Promise<Response>,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await handler(
    new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function plaidAccount(id: string, name: string, mask: string | null): AccountBase {
  return {
    account_id: id,
    name,
    official_name: null,
    mask,
    type: "depository",
    subtype: "checking",
    balances: {
      current: 1234.56,
      available: 1200,
      limit: null,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
  } as AccountBase;
}

function itemGetResponse(over: {
  item_id: string;
  institution_id?: string | null;
  institution_name?: string | null;
  error?: { error_code: string } | null;
  consent_expiration_time?: string | null;
}) {
  return {
    data: {
      item: {
        item_id: over.item_id,
        institution_id: over.institution_id ?? "ins_1",
        institution_name: over.institution_name ?? "Test Bank",
        webhook: null,
        error: over.error ?? null,
        available_products: [],
        billed_products: [],
        consent_expiration_time: over.consent_expiration_time ?? null,
        update_type: "background",
      },
      status: {},
    },
  };
}

/** Plaid's view of each sandbox-like item, keyed by access token. */
type FakeItem = {
  itemId: string;
  institutionId: string;
  institutionName: string;
  accounts: AccountBase[];
  error?: { error_code: string } | null;
  consentExpiresAt?: string | null;
};
let fakeItems: Map<string, FakeItem>;
/** public_token → access_token */
let publicTokens: Map<string, string>;

function installPlaidFakes() {
  mocks.plaid.itemPublicTokenExchange.mockImplementation(
    async ({ public_token }: { public_token: string }) => {
      const access = publicTokens.get(public_token);
      if (!access) {
        throw Object.assign(new Error("Request failed with status code 400"), {
          response: { status: 400, data: { error_code: "INVALID_PUBLIC_TOKEN", error_type: "INVALID_INPUT", error_message: "raw plaid message" } },
        });
      }
      await new Promise((r) => setTimeout(r, 5));
      return { data: { access_token: access, item_id: fakeItems.get(access)!.itemId } };
    },
  );
  mocks.plaid.itemGet.mockImplementation(async ({ access_token }: { access_token: string }) => {
    const f = fakeItems.get(access_token)!;
    return itemGetResponse({
      item_id: f.itemId,
      institution_id: f.institutionId,
      institution_name: f.institutionName,
      error: f.error ?? null,
      consent_expiration_time: f.consentExpiresAt ?? null,
    });
  });
  mocks.plaid.accountsGet.mockImplementation(async ({ access_token }: { access_token: string }) => {
    const f = fakeItems.get(access_token)!;
    return { data: { accounts: f.accounts, item: { item_id: f.itemId } } };
  });
  mocks.plaid.itemRemove.mockResolvedValue({ data: { request_id: "r" } });
  mocks.plaid.linkTokenCreate.mockResolvedValue({
    data: { link_token: "link-sandbox-test", expiration: "2026-10-13T12:00:00Z" },
  });
}

async function seedUsers() {
  await getTestDb().insert(user).values([
    makeUser({ id: "u1", email: "u1@test.local" }),
    makeUser({ id: "u2", email: "u2@test.local" }),
  ]);
}

/** An existing connection for u1 at ins_1 with one "Checking" account (mask 0000). */
async function seedExistingItem(over: Parameters<typeof makePlaidItem>[0] = {}, mask: string | null = "0000") {
  const db = getTestDb();
  await db.insert(plaidItems).values(
    makePlaidItem({
      id: "existing",
      userId: "u1",
      itemId: "item-existing",
      accessToken: encrypt("access-existing"),
      institutionId: "ins_1",
      institutionName: "Test Bank",
      ...over,
    }),
  );
  await db.insert(financialAccounts).values(
    makeAccount({
      id: "acct-existing",
      userId: "u1",
      plaidItemId: "existing",
      plaidAccountId: "pa-existing-checking",
      name: "Checking",
      mask,
    }),
  );
  fakeItems.set("access-existing", {
    itemId: "item-existing",
    institutionId: "ins_1",
    institutionName: "Test Bank",
    accounts: [plaidAccount("pa-existing-checking", "Checking", "0000")],
  });
}

/** A fresh Link session at Plaid that would mint a new Item. */
function newLinkSession(publicToken: string, accessToken: string, item: Omit<FakeItem, "accounts"> & { accounts?: AccountBase[] }) {
  publicTokens.set(publicToken, accessToken);
  fakeItems.set(accessToken, { accounts: [], ...item });
}

const metadata = (institutionId: string | null, accounts: Array<{ name: string; mask: string | null }>) => ({
  institution: institutionId ? { name: "Whatever The Client Says", institutionId } : null,
  accounts: accounts.map((a, i) => ({ id: `client-acc-${i}`, name: a.name, mask: a.mask, type: "depository", subtype: "checking" })),
});

beforeEach(async () => {
  vi.clearAllMocks();
  fakeItems = new Map();
  publicTokens = new Map();
  installPlaidFakes();
  mocks.session.current = { user: { id: "u1" } };
  await seedUsers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- exchange-token -----------------------------------------------------------

describe("POST /api/plaid/exchange-token", () => {
  it("detects a duplicate (institution + name + mask) BEFORE exchanging and returns 409 with the existing item id", async () => {
    await seedExistingItem();
    newLinkSession("public-dup", "access-dup", { itemId: "item-dup", institutionId: "ins_1", institutionName: "Test Bank" });

    const res = await call(exchangeToken, {
      publicToken: "public-dup",
      metadata: metadata("ins_1", [{ name: "Checking", mask: "0000" }]),
    });

    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ success: false, code: "DUPLICATE_ITEM", existingPlaidItemId: "existing" });
    expect(mocks.plaid.itemPublicTokenExchange).not.toHaveBeenCalled();
    expect(mocks.plaid.itemRemove).not.toHaveBeenCalled();
    expect(await getTestDb().select().from(plaidItems)).toHaveLength(1);
  });

  it.each([
    ["login_required", null],
    ["active", "pending_disconnect"],
    ["pending_expiration", null],
  ])("treats an existing item in status %s (attention %s) as the duplicate", async (status, attention) => {
    await seedExistingItem({ status, attention });
    newLinkSession("public-dup", "access-dup", { itemId: "item-dup", institutionId: "ins_1", institutionName: "Test Bank" });

    const res = await call(exchangeToken, {
      publicToken: "public-dup",
      metadata: metadata("ins_1", [{ name: "Checking", mask: "0000" }, { name: "Brand New Savings", mask: "4321" }]),
    });

    expect(res.status).toBe(409);
    expect(res.json.existingPlaidItemId).toBe("existing");
    expect(mocks.plaid.itemPublicTokenExchange).not.toHaveBeenCalled();
  });

  it("does not treat a terminal (revoked) item as a duplicate", async () => {
    await seedExistingItem({ status: "revoked" });
    newLinkSession("public-new", "access-new", {
      itemId: "item-new", institutionId: "ins_1", institutionName: "Test Bank",
      accounts: [plaidAccount("pa-new-1", "Checking", "0000")],
    });

    const res = await call(exchangeToken, {
      publicToken: "public-new",
      metadata: metadata("ins_1", [{ name: "Checking", mask: "0000" }]),
    });
    expect(res.status).toBe(200);
  });

  it("allows a different login at the same institution (different masks)", async () => {
    await seedExistingItem();
    newLinkSession("public-other", "access-other", {
      itemId: "item-other", institutionId: "ins_1", institutionName: "Test Bank",
      accounts: [plaidAccount("pa-other-1", "Checking", "9876")],
    });

    const res = await call(exchangeToken, {
      publicToken: "public-other",
      metadata: metadata("ins_1", [{ name: "Checking", mask: "9876" }]),
    });

    expect(res.status).toBe(200);
    expect(mocks.plaid.itemPublicTokenExchange).toHaveBeenCalledTimes(1);
    expect(mocks.plaid.itemRemove).not.toHaveBeenCalled();
    const rows = await getTestDb().select().from(plaidItems);
    expect(rows.map((r) => r.itemId).sort()).toEqual(["item-existing", "item-other"]);
  });

  it("backfills unknown masks of existing items via /accounts/get before comparing", async () => {
    // Legacy row: mask unknown. Plaid says the existing account's mask is 0000.
    await seedExistingItem({}, null);
    newLinkSession("public-other", "access-other", {
      itemId: "item-other", institutionId: "ins_1", institutionName: "Test Bank",
      accounts: [plaidAccount("pa-other-1", "Checking", "9876")],
    });

    const res = await call(exchangeToken, {
      publicToken: "public-other",
      metadata: metadata("ins_1", [{ name: "Checking", mask: "9876" }]),
    });

    expect(res.status).toBe(200); // name alone would have matched; name+mask does not
    expect(mocks.plaid.accountsGet).toHaveBeenCalledWith({ access_token: "access-existing" });
    const [legacy] = await getTestDb().select().from(financialAccounts).where(eq(financialAccounts.id, "acct-existing"));
    expect(legacy.mask).toBe("0000");
  });

  it("takes the institution and accounts from Plaid, not from the client, and requests a sync", async () => {
    newLinkSession("public-new", "access-new", {
      itemId: "item-new", institutionId: "ins_real", institutionName: "Real Bank",
      consentExpiresAt: "2027-04-20T20:32:50Z",
      accounts: [plaidAccount("pa-new-1", "Everyday Checking", "1111"), plaidAccount("pa-new-2", "Rainy Day Savings", "2222")],
    });

    const res = await call(exchangeToken, {
      publicToken: "public-new",
      metadata: {
        institution: { name: "Fake Bank", institutionId: "ins_fake" },
        accounts: [{ id: "client-forged-id", name: "Forged", mask: "9999", type: "depository", subtype: "checking" }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ itemId: "item-new", institutionName: "Real Bank", accounts: 2 });
    const [item] = await getTestDb().select().from(plaidItems).where(eq(plaidItems.itemId, "item-new"));
    expect(item).toMatchObject({ userId: "u1", institutionId: "ins_real", institutionName: "Real Bank", status: "active" });
    expect(item.consentExpiresAt?.toISOString()).toBe("2027-04-20T20:32:50.000Z");
    expect(decrypt(item.accessToken)).toBe("access-new");
    expect(item.syncRequestedAt).toBeInstanceOf(Date);
    expect(item.recurringRequestedAt).toBeNull();

    const accounts = await getTestDb().select().from(financialAccounts).where(eq(financialAccounts.plaidItemId, item.id));
    expect(accounts.map((a) => [a.plaidAccountId, a.name, a.mask]).sort()).toEqual([
      ["pa-new-1", "Everyday Checking", "1111"],
      ["pa-new-2", "Rainy Day Savings", "2222"],
    ]);
    expect(accounts.some((a) => a.plaidAccountId === "client-forged-id")).toBe(false);
  });

  it("detects a duplicate after exchange when the client sent no metadata: removes the new Item at Plaid and returns 409", async () => {
    await seedExistingItem();
    newLinkSession("public-dup", "access-dup", {
      itemId: "item-dup", institutionId: "ins_1", institutionName: "Test Bank",
      accounts: [plaidAccount("pa-dup-1", "Checking", "0000")],
    });

    const res = await call(exchangeToken, { publicToken: "public-dup", metadata: { institution: null, accounts: [] } });

    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "DUPLICATE_ITEM", existingPlaidItemId: "existing" });
    expect(mocks.plaid.itemRemove).toHaveBeenCalledWith({ access_token: "access-dup" });
    const rows = await getTestDb().select().from(plaidItems);
    expect(rows.map((r) => r.itemId)).toEqual(["item-existing"]);
    expect(await getTestDb().select().from(financialAccounts)).toHaveLength(1);
  });

  it("concurrent exchanges of the same login: one is stored, the other Item is removed at Plaid and gets 409", async () => {
    for (const n of [1, 2]) {
      newLinkSession(`public-race-${n}`, `access-race-${n}`, {
        itemId: `item-race-${n}`, institutionId: "ins_1", institutionName: "Test Bank",
        accounts: [plaidAccount(`pa-race-${n}`, "Checking", "0000")],
      });
    }
    // Both requests carry full metadata, and both pass the pre-exchange check
    // because neither Item is stored yet.
    const body = (n: number) => ({ publicToken: `public-race-${n}`, metadata: metadata("ins_1", [{ name: "Checking", mask: "0000" }]) });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const results = await Promise.all([call(exchangeToken, body(1)), call(exchangeToken, body(2))]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(mocks.plaid.itemPublicTokenExchange).toHaveBeenCalledTimes(2);
    // The loser was caught by the locked re-check after its exchange.
    expect(info.mock.calls.flat().join("\n")).toMatch(/plaid-link\.duplicate-detected .*"stage":"post-exchange"/);
    const rows = await getTestDb().select().from(plaidItems);
    expect(rows).toHaveLength(1);
    const winner = rows[0].itemId;
    const loserAccess = winner === "item-race-1" ? "access-race-2" : "access-race-1";
    expect(mocks.plaid.itemRemove).toHaveBeenCalledTimes(1);
    expect(mocks.plaid.itemRemove).toHaveBeenCalledWith({ access_token: loserAccess });
    const conflict = results.find((r) => r.status === 409)!;
    expect(conflict.json.existingPlaidItemId).toBe(rows[0].id);
  });

  it("a database uniqueness rule (legacy one-active-item-per-institution index) also ends in removal + 409", async () => {
    const db = getTestDb();
    await db.execute(sql`CREATE UNIQUE INDEX plaid_items_user_institution_active_idx ON plaid_items (user_id, institution_id) WHERE status = 'active'`);
    try {
      await seedExistingItem();
      newLinkSession("public-other", "access-other", {
        itemId: "item-other", institutionId: "ins_1", institutionName: "Test Bank",
        accounts: [plaidAccount("pa-other-1", "Checking", "9876")],
      });

      const res = await call(exchangeToken, {
        publicToken: "public-other",
        metadata: metadata("ins_1", [{ name: "Checking", mask: "9876" }]),
      });

      expect(res.status).toBe(409);
      expect(res.json.existingPlaidItemId).toBe("existing");
      expect(mocks.plaid.itemRemove).toHaveBeenCalledWith({ access_token: "access-other" });
      expect(await db.select().from(plaidItems)).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP INDEX IF EXISTS plaid_items_user_institution_active_idx`);
    }
  });

  it("removes the new Item when anything after the exchange fails, without leaking Plaid's raw error", async () => {
    newLinkSession("public-new", "access-new", { itemId: "item-new", institutionId: "ins_1", institutionName: "Test Bank" });
    mocks.plaid.accountsGet.mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 500"), {
        response: { status: 500, data: { error_code: "INTERNAL_SERVER_ERROR", error_type: "API_ERROR", error_message: "raw plaid message" } },
        config: { headers: { "PLAID-SECRET": "should-never-be-logged" } },
      }),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await call(exchangeToken, { publicToken: "public-new", metadata: metadata("ins_1", []) });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.json)).not.toContain("raw plaid message");
    expect(mocks.plaid.itemRemove).toHaveBeenCalledWith({ access_token: "access-new" });
    expect(await getTestDb().select().from(plaidItems)).toHaveLength(0);
    expect(logged.mock.calls.flat().join(" ")).not.toContain("should-never-be-logged");
  });

  it("maps a Plaid exchange error to a friendly message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(exchangeToken, { publicToken: "public-unknown", metadata: metadata(null, []) });
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("That bank connection session expired. Please start the connection again.");
  });

  it("rejects unauthenticated and malformed requests", async () => {
    mocks.session.current = null;
    expect((await call(exchangeToken, { publicToken: "x" })).status).toBe(401);
    mocks.session.current = { user: { id: "u1" } };
    expect((await call(exchangeToken, { publicToken: "" })).status).toBe(400);
    expect(mocks.plaid.itemPublicTokenExchange).not.toHaveBeenCalled();
  });
});

// --- create-link-token --------------------------------------------------------

describe("POST /api/plaid/create-link-token", () => {
  it("creates a new-link token with the transactions product", async () => {
    const res = await call(createLinkTokenRoute, {});
    expect(res.status).toBe(200);
    expect(mocks.plaid.linkTokenCreate.mock.calls[0][0]).toMatchObject({ products: ["transactions"], user: { client_user_id: "u1" } });
  });

  it("creates an update-mode token with account selection for the user's own item", async () => {
    await seedExistingItem();
    const res = await call(createLinkTokenRoute, { plaidItemId: "existing", accountSelection: true });
    expect(res.status).toBe(200);
    const req = mocks.plaid.linkTokenCreate.mock.calls[0][0];
    expect(req).toMatchObject({ access_token: "access-existing", update: { account_selection_enabled: true } });
    expect(req.products).toBeUndefined();
  });

  it("plain reconnect does not enable account selection", async () => {
    await seedExistingItem({ status: "login_required" });
    await call(createLinkTokenRoute, { plaidItemId: "existing" });
    expect(mocks.plaid.linkTokenCreate.mock.calls[0][0].update).toBeUndefined();
  });

  it("returns 404 for another user's item and never calls Plaid", async () => {
    await seedExistingItem();
    mocks.session.current = { user: { id: "u2" } };
    const res = await call(createLinkTokenRoute, { plaidItemId: "existing", accountSelection: true });
    expect(res.status).toBe(404);
    expect(mocks.plaid.linkTokenCreate).not.toHaveBeenCalled();
  });

  it("rejects accountSelection without an item", async () => {
    expect((await call(createLinkTokenRoute, { accountSelection: true })).status).toBe(400);
  });
});

// --- update-complete ----------------------------------------------------------

describe("POST /api/plaid/update-complete", () => {
  it("flips a repaired item to active, adds newly shared accounts, closes de-selected ones, and requests a sync", async () => {
    await seedExistingItem({ status: "login_required", attention: "login_required", lastSyncErrorCode: "ITEM_LOGIN_REQUIRED" });
    await getTestDb().insert(financialAccounts).values(
      makeAccount({ id: "acct-dropped", userId: "u1", plaidItemId: "existing", plaidAccountId: "pa-existing-old", name: "Old Card", mask: "5555" }),
    );
    fakeItems.set("access-existing", {
      itemId: "item-existing", institutionId: "ins_1", institutionName: "Test Bank",
      consentExpiresAt: "2027-01-01T00:00:00Z",
      accounts: [plaidAccount("pa-existing-checking", "Checking", "0000"), plaidAccount("pa-existing-new", "New Savings", "7777")],
    });

    const res = await call(updateComplete, { plaidItemId: "existing", accountSelection: true });

    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ plaidItemId: "existing", status: "active", accountsAdded: 1, accountsClosed: 1, accounts: 2 });
    expect(mocks.plaid.itemPublicTokenExchange).not.toHaveBeenCalled();

    const db = getTestDb();
    const [item] = await db.select().from(plaidItems).where(eq(plaidItems.id, "existing"));
    expect(item).toMatchObject({ status: "active", attention: null, lastSyncErrorCode: null });
    expect(item.consentExpiresAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(item.syncRequestedAt).toBeInstanceOf(Date);
    expect(item.recurringRequestedAt).toBeInstanceOf(Date);

    const accounts = await db.select().from(financialAccounts).where(eq(financialAccounts.plaidItemId, "existing"));
    const byId = new Map(accounts.map((a) => [a.plaidAccountId, a]));
    expect(byId.get("pa-existing-new")).toMatchObject({ userId: "u1", name: "New Savings", mask: "7777", closedAt: null });
    expect(byId.get("pa-existing-old")?.closedAt).toBeInstanceOf(Date);
    expect(byId.get("pa-existing-checking")?.closedAt).toBeNull();
  });

  it("keeps the 'new accounts available' prompt after a plain reconnect, clears it after account selection", async () => {
    await seedExistingItem({ attention: "new_accounts_available" });
    await call(updateComplete, { plaidItemId: "existing" });
    let [item] = await getTestDb().select().from(plaidItems);
    expect(item.attention).toBe("new_accounts_available");

    await call(updateComplete, { plaidItemId: "existing", accountSelection: true });
    [item] = await getTestDb().select().from(plaidItems);
    expect(item.attention).toBeNull();
  });

  it("returns 409 and changes nothing while Plaid still reports an error", async () => {
    await seedExistingItem({ status: "login_required" });
    fakeItems.get("access-existing")!.error = { error_code: "ITEM_LOGIN_REQUIRED" };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await call(updateComplete, { plaidItemId: "existing" });

    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "ITEM_NOT_HEALTHY", error: expect.stringContaining("re-authenticated") });
    const [item] = await getTestDb().select().from(plaidItems);
    expect(item.status).toBe("login_required");
    expect(item.syncRequestedAt).toBeNull();
    expect(mocks.plaid.accountsGet).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's item without touching Plaid or the row", async () => {
    await seedExistingItem({ status: "login_required" });
    mocks.session.current = { user: { id: "u2" } };

    const res = await call(updateComplete, { plaidItemId: "existing" });

    expect(res.status).toBe(404);
    expect(mocks.plaid.itemGet).not.toHaveBeenCalled();
    const [item] = await getTestDb().select().from(plaidItems);
    expect(item.status).toBe("login_required");
  });

  it("validates the body and requires a session", async () => {
    expect((await call(updateComplete, {})).status).toBe(400);
    mocks.session.current = null;
    expect((await call(updateComplete, { plaidItemId: "existing" })).status).toBe(401);
  });
});
