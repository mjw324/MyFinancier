import { CountryCode, Products, type AccountBase } from "plaid";
import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema/plaid";
import { financialAccounts } from "@/lib/db/schema/accounts";
import { encrypt, decrypt } from "@/lib/utils/encryption";
import { describeError, logError } from "@/lib/logging";
import { plaidClient } from "./client";
import { refreshAccountsFromPlaid, upsertPlaidAccounts } from "./accounts";
import { requestItemSync } from "./sync-requests";
import {
  TERMINAL_ITEM_STATUSES,
  type ExchangeTokenResponse,
  type LinkTokenResponse,
  type PlaidLinkMetadata,
  type UpdateCompleteResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Errors the API routes map to HTTP responses
// ---------------------------------------------------------------------------

/**
 * The user is linking a connection they already have. Plaid's guidance
 * (https://plaid.com/docs/link/duplicate-items/): "Do not exchange a public
 * token for an access token if you detect a duplicate Item" — send the user
 * through update mode on the existing Item instead.
 */
export class DuplicateItemError extends Error {
  readonly code = "DUPLICATE_ITEM" as const;
  constructor(
    readonly existingPlaidItemId: string,
    readonly institutionName: string | null,
    /** Where it was caught: before exchange (no Plaid Item created) or after (new Item removed). */
    readonly stage: "pre-exchange" | "post-exchange",
  ) {
    super(`${institutionName ?? "This bank"} is already connected`);
    this.name = "DuplicateItemError";
  }
}

/** The item does not exist or belongs to another user (both map to 404). */
export class PlaidItemNotFoundError extends Error {
  constructor() {
    super("Plaid item not found");
    this.name = "PlaidItemNotFoundError";
  }
}

/** Plaid still reports an error on the Item after update mode. */
export class ItemNotHealthyError extends Error {
  constructor(readonly plaidErrorCode: string | null) {
    super(`Plaid item still reports ${plaidErrorCode ?? "an error"}`);
    this.name = "ItemNotHealthyError";
  }
}

/** Structured, secret-free info log (ids only). */
function logEvent(
  event: string,
  context: Record<string, string | number | boolean | null | undefined>,
): void {
  console.info(`[info] ${event} ${JSON.stringify(context)}`);
}

function isUniqueViolation(error: unknown): boolean {
  return describeError(error).pgCode === "23505";
}

// ---------------------------------------------------------------------------
// Link tokens
// ---------------------------------------------------------------------------

export async function createLinkToken(
  userId: string,
): Promise<LinkTokenResponse> {
  const response = await plaidClient.linkTokenCreate({
    client_name: "MyFinancier",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: userId },
    products: [Products.Transactions],
    transactions: { days_requested: 730 },
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
  });

  return {
    linkToken: response.data.link_token,
    expiration: response.data.expiration,
  };
}

/**
 * Link token for update mode on one of the user's Items (reconnect, renew
 * consent, or — with `accountSelection` — share additional accounts). Per
 * https://plaid.com/docs/link/update-mode/ no `products` are passed.
 */
export async function createUpdateLinkToken(
  userId: string,
  plaidItemId: string,
  options: { accountSelection?: boolean } = {},
): Promise<LinkTokenResponse> {
  const [item] = await db
    .select({ accessToken: plaidItems.accessToken })
    .from(plaidItems)
    .where(and(eq(plaidItems.id, plaidItemId), eq(plaidItems.userId, userId)));

  if (!item) throw new PlaidItemNotFoundError();

  const response = await plaidClient.linkTokenCreate({
    client_name: "MyFinancier",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: userId },
    access_token: decrypt(item.accessToken),
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
    ...(options.accountSelection
      ? { update: { account_selection_enabled: true } }
      : {}),
  });

  return {
    linkToken: response.data.link_token,
    expiration: response.data.expiration,
  };
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export type AccountFingerprint = { name: string; mask: string | null };

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Plaid's recommended duplicate signal: same institution and an account with
 * the same `name` and `mask`. One shared account is enough — a duplicate Item
 * need not share every account (account selection). A null mask on either
 * side (legacy rows created before `mask` was stored, or accounts Plaid has no
 * mask for) falls back to the name alone.
 */
export function accountsOverlap(
  candidate: AccountFingerprint[],
  existing: AccountFingerprint[],
): boolean {
  return candidate.some((c) =>
    existing.some(
      (e) =>
        normalizeName(c.name) === normalizeName(e.name) &&
        (c.mask == null || e.mask == null || c.mask === e.mask),
    ),
  );
}

type DuplicateCandidate = {
  id: string;
  institutionName: string | null;
  accounts: AccountFingerprint[];
};

/** The user's live (non-terminal) Items at an institution, with their accounts (open or closed). */
async function liveItemsAtInstitution(
  executor: DbExecutor,
  userId: string,
  institutionId: string,
  excludePlaidItemId?: string,
): Promise<DuplicateCandidate[]> {
  const rows = await executor
    .select({
      id: plaidItems.id,
      institutionName: plaidItems.institutionName,
      accountName: financialAccounts.name,
      accountMask: financialAccounts.mask,
    })
    .from(plaidItems)
    .leftJoin(
      financialAccounts,
      eq(financialAccounts.plaidItemId, plaidItems.id),
    )
    .where(
      and(
        eq(plaidItems.userId, userId),
        eq(plaidItems.institutionId, institutionId),
        notInArray(plaidItems.status, [...TERMINAL_ITEM_STATUSES]),
        excludePlaidItemId ? ne(plaidItems.itemId, excludePlaidItemId) : undefined,
      ),
    )
    .orderBy(plaidItems.createdAt);

  const byId = new Map<string, DuplicateCandidate>();
  for (const row of rows) {
    let item = byId.get(row.id);
    if (!item) {
      item = { id: row.id, institutionName: row.institutionName, accounts: [] };
      byId.set(row.id, item);
    }
    if (row.accountName != null) {
      item.accounts.push({ name: row.accountName, mask: row.accountMask });
    }
  }
  return [...byId.values()];
}

/** First live Item of the user at `institutionId` sharing an account (name + mask) with `accounts`. */
export async function findDuplicateItem(
  executor: DbExecutor,
  userId: string,
  institutionId: string | null | undefined,
  accounts: AccountFingerprint[],
  { excludePlaidItemId }: { excludePlaidItemId?: string } = {},
): Promise<{ id: string; institutionName: string | null } | null> {
  if (!institutionId || accounts.length === 0) return null;
  const items = await liveItemsAtInstitution(
    executor,
    userId,
    institutionId,
    excludePlaidItemId,
  );
  const match = items.find((item) => accountsOverlap(accounts, item.accounts));
  return match ? { id: match.id, institutionName: match.institutionName } : null;
}

/**
 * Pre-exchange check on Link's onSuccess metadata. Items whose accounts were
 * stored before `mask` existed get their accounts refreshed from
 * /accounts/get (free, cached) first, so the comparison uses name + mask
 * rather than name alone. A failed refresh (e.g. the Item needs a login)
 * leaves the name-only fallback in place.
 */
async function findDuplicateBeforeExchange(
  userId: string,
  metadata: PlaidLinkMetadata,
): Promise<{ id: string; institutionName: string | null } | null> {
  const institutionId = metadata.institution?.institutionId || null;
  const accounts = metadata.accounts.map((a) => ({ name: a.name, mask: a.mask ?? null }));
  if (!institutionId || accounts.length === 0) return null;

  const items = await liveItemsAtInstitution(db, userId, institutionId);
  const stale = items.filter((i) => i.accounts.some((a) => a.mask == null));
  for (const item of stale) {
    try {
      await refreshAccountsFromPlaid(item.id);
    } catch (error) {
      logError("plaid-link.mask-refresh-failed", error, { plaidItemRowId: item.id });
    }
  }
  return findDuplicateItem(db, userId, institutionId, accounts);
}

// ---------------------------------------------------------------------------
// New Item (exchange)
// ---------------------------------------------------------------------------

/**
 * Serialises link completions per user for the rest of the transaction, so
 * two concurrent exchanges cannot both pass the duplicate check. Transaction-
 * scoped, so it is safe through Supabase's transaction pooler.
 */
async function lockUserLinking(tx: DbExecutor, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`plaid-link:${userId}`}, 0))`,
  );
}

async function institutionNameFor(
  institutionId: string | null,
): Promise<string | null> {
  if (!institutionId) return null;
  try {
    const res = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    return res.data.institution.name;
  } catch (error) {
    logError("plaid-link.institution-lookup-failed", error, { institutionId });
    return null;
  }
}

/**
 * /item/remove a freshly exchanged Item that we did not keep, so it is never
 * left orphaned (and billed) at Plaid. Never touches an Item we store.
 */
async function removeUnstoredItem(
  accessToken: string,
  plaidItemId: string,
  reason: string,
): Promise<void> {
  const [stored] = await db
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(eq(plaidItems.itemId, plaidItemId));
  if (stored) return;
  try {
    await plaidClient.itemRemove({ access_token: accessToken });
    logEvent("plaid-link.new-item-removed", { plaidItemId, reason });
  } catch (error) {
    // Needs manual cleanup: the item_id is enough to find it in the Plaid dashboard.
    logError("plaid-link.orphan-remove-failed", error, { plaidItemId, reason });
  }
}

/**
 * Complete a NEW Link session: duplicate check on the (untrusted) metadata
 * before exchanging, then exchange, take the institution from /item/get and
 * the accounts from /accounts/get, and store everything in one transaction
 * under a per-user lock that re-runs the duplicate check against committed
 * Items. Any failure after the exchange removes the new Item at Plaid.
 *
 * Throws DuplicateItemError (→ 409) when the user already has this connection.
 */
export async function exchangePublicToken(
  publicToken: string,
  userId: string,
  metadata: PlaidLinkMetadata,
): Promise<ExchangeTokenResponse> {
  const preexisting = await findDuplicateBeforeExchange(userId, metadata);
  if (preexisting) {
    logEvent("plaid-link.duplicate-detected", {
      stage: "pre-exchange",
      existingPlaidItemRowId: preexisting.id,
      exchanged: false,
    });
    throw new DuplicateItemError(
      preexisting.id,
      preexisting.institutionName,
      "pre-exchange",
    );
  }

  const exchange = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const accessToken = exchange.data.access_token;
  const plaidItemId = exchange.data.item_id;
  logEvent("plaid-link.exchanged", { plaidItemId });

  // An item_id we already store means this was an update-mode public_token
  // (e.g. from a client bundle older than /api/plaid/update-complete). Never
  // remove it: keep the token Plaid returned and finish it as an update.
  const [known] = await db
    .select({ id: plaidItems.id, userId: plaidItems.userId })
    .from(plaidItems)
    .where(eq(plaidItems.itemId, plaidItemId));
  if (known) {
    if (known.userId !== userId) {
      throw new Error("Exchanged Plaid item is linked to another user");
    }
    await db
      .update(plaidItems)
      .set({ accessToken: encrypt(accessToken), updatedAt: new Date() })
      .where(eq(plaidItems.id, known.id));
    const updated = await completeItemUpdate(userId, known.id, {
      accountSelection: true,
    });
    const [row] = await db
      .select({ institutionName: plaidItems.institutionName })
      .from(plaidItems)
      .where(eq(plaidItems.id, known.id));
    return {
      plaidItemId: known.id,
      itemId: plaidItemId,
      institutionName: row?.institutionName ?? null,
      accounts: updated.accounts,
    };
  }

  let institutionId: string | null = null;
  try {
    const [itemRes, accountsRes] = await Promise.all([
      plaidClient.itemGet({ access_token: accessToken }),
      plaidClient.accountsGet({ access_token: accessToken }),
    ]);
    const item = itemRes.data.item;
    institutionId = item.institution_id ?? null;
    const institutionName =
      item.institution_name ?? (await institutionNameFor(institutionId));
    const accounts: AccountBase[] = accountsRes.data.accounts;

    const stored = await db.transaction(async (tx) => {
      await lockUserLinking(tx, userId);

      const duplicate = await findDuplicateItem(
        tx,
        userId,
        institutionId,
        accounts.map((a) => ({ name: a.name, mask: a.mask ?? null })),
        { excludePlaidItemId: plaidItemId },
      );
      if (duplicate) {
        throw new DuplicateItemError(
          duplicate.id,
          duplicate.institutionName,
          "post-exchange",
        );
      }

      const [row] = await tx
        .insert(plaidItems)
        .values({
          userId,
          accessToken: encrypt(accessToken),
          itemId: plaidItemId,
          institutionId,
          institutionName,
          status: "active",
          consentExpiresAt: item.consent_expiration_time
            ? new Date(item.consent_expiration_time)
            : null,
        })
        .returning({ id: plaidItems.id, userId: plaidItems.userId });

      const upsert = await upsertPlaidAccounts(tx, row, accounts, {
        authoritative: true,
      });
      if (upsert.conflicts.length > 0) {
        // Account ids are per Item, so this only happens if the accounts are
        // already stored under another Item: treat it as that duplicate.
        const [owner] = await tx
          .select({
            plaidItemId: financialAccounts.plaidItemId,
            userId: financialAccounts.userId,
            institutionName: plaidItems.institutionName,
          })
          .from(financialAccounts)
          .innerJoin(plaidItems, eq(plaidItems.id, financialAccounts.plaidItemId))
          .where(inArray(financialAccounts.plaidAccountId, upsert.conflicts));
        if (owner && owner.userId === userId) {
          throw new DuplicateItemError(
            owner.plaidItemId,
            owner.institutionName,
            "post-exchange",
          );
        }
        throw new Error("Plaid accounts are already linked to another item");
      }

      await requestItemSync(row.id, { recurring: false }, tx);
      return { id: row.id, accounts: upsert.upserted };
    });

    logEvent("plaid-link.item-stored", {
      plaidItemRowId: stored.id,
      plaidItemId,
      accounts: stored.accounts,
    });
    return {
      plaidItemId: stored.id,
      itemId: plaidItemId,
      institutionName,
      accounts: stored.accounts,
    };
  } catch (error) {
    let duplicate = error instanceof DuplicateItemError ? error : null;
    if (!duplicate && isUniqueViolation(error) && institutionId) {
      // A database-level uniqueness rule (e.g. the legacy
      // plaid_items_user_institution_active_idx) rejected the Item.
      const [active] = await db
        .select({ id: plaidItems.id, institutionName: plaidItems.institutionName })
        .from(plaidItems)
        .where(
          and(
            eq(plaidItems.userId, userId),
            eq(plaidItems.institutionId, institutionId),
            eq(plaidItems.status, "active"),
          ),
        );
      if (active) {
        duplicate = new DuplicateItemError(active.id, active.institutionName, "post-exchange");
      }
    }

    await removeUnstoredItem(
      accessToken,
      plaidItemId,
      duplicate ? "duplicate" : "store-failed",
    );

    if (duplicate) {
      logEvent("plaid-link.duplicate-detected", {
        stage: "post-exchange",
        existingPlaidItemRowId: duplicate.existingPlaidItemId,
        newPlaidItemId: plaidItemId,
        exchanged: true,
      });
      throw duplicate;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Update mode completion
// ---------------------------------------------------------------------------

/**
 * Called after Link update mode succeeds (reconnect, consent renewal, or
 * account selection). The access token does not change in update mode
 * (https://plaid.com/docs/link/update-mode/), so nothing is exchanged:
 * confirm health with /item/get, mark the Item active, take the account set
 * from /accounts/get (adds newly shared accounts, closes de-selected ones)
 * and request a sync.
 */
export async function completeItemUpdate(
  userId: string,
  plaidItemRowId: string,
  { accountSelection = false }: { accountSelection?: boolean } = {},
): Promise<UpdateCompleteResponse> {
  const [item] = await db
    .select({
      id: plaidItems.id,
      userId: plaidItems.userId,
      accessToken: plaidItems.accessToken,
      institutionName: plaidItems.institutionName,
      attention: plaidItems.attention,
    })
    .from(plaidItems)
    .where(and(eq(plaidItems.id, plaidItemRowId), eq(plaidItems.userId, userId)));
  if (!item) throw new PlaidItemNotFoundError();

  const accessToken = decrypt(item.accessToken);
  const itemRes = await plaidClient.itemGet({ access_token: accessToken });
  const plaidItem = itemRes.data.item;
  if (plaidItem.error) {
    throw new ItemNotHealthyError(plaidItem.error.error_code ?? null);
  }

  const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
  const accounts: AccountBase[] = accountsRes.data.accounts;

  const result = await db.transaction(async (tx) => {
    const openBefore = await tx
      .select({ plaidAccountId: financialAccounts.plaidAccountId })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.plaidItemId, item.id),
          isNull(financialAccounts.closedAt),
        ),
      );
    const before = new Set(openBefore.map((a) => a.plaidAccountId));

    // "Add accounts" prompts are only resolved by an account-selection session.
    const keepAttention =
      item.attention === "new_accounts_available" && !accountSelection;

    await tx
      .update(plaidItems)
      .set({
        status: "active",
        attention: keepAttention ? item.attention : null,
        lastSyncErrorCode: null,
        consentExpiresAt: plaidItem.consent_expiration_time
          ? new Date(plaidItem.consent_expiration_time)
          : null,
        institutionName: item.institutionName ?? plaidItem.institution_name ?? null,
        updatedAt: new Date(),
      })
      .where(eq(plaidItems.id, item.id));

    const upsert = await upsertPlaidAccounts(tx, item, accounts, {
      authoritative: true,
    });
    if (upsert.conflicts.length > 0) {
      logEvent("plaid-update.account-conflicts", {
        plaidItemRowId: item.id,
        conflicts: upsert.conflicts.length,
      });
    }

    await requestItemSync(item.id, { recurring: true }, tx);

    const [{ open }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.plaidItemId, item.id),
          isNull(financialAccounts.closedAt),
        ),
      );

    return {
      added: accounts.filter((a) => !before.has(a.account_id)).length,
      closed: upsert.closed,
      open,
    };
  });

  logEvent("plaid-update.completed", {
    plaidItemRowId: item.id,
    accountsAdded: result.added,
    accountsClosed: result.closed,
  });

  return {
    plaidItemId: item.id,
    status: "active",
    accountsAdded: result.added,
    accountsClosed: result.closed,
    accounts: result.open,
  };
}
