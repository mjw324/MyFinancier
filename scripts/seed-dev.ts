/**
 * Seed a LOCAL development database with the development profiles in
 * ./seed-profiles.ts: verified users whose Plaid sandbox Items are linked and
 * fully synced (history + recurring streams), plus budgets, spending rules,
 * stream classifications, display overrides and a broken connection — so
 * every screen has realistic data without sign-up email or Plaid Link.
 *
 * Usage (tsx resolves the "@/..." aliases from tsconfig.json):
 *   pnpm db:seed
 *   pnpm dlx tsx@4.19.2 scripts/seed-dev.ts --env-file .env --only alex
 *
 * Options:
 *   --env-file <path>   load env from this file (nothing is loaded otherwise)
 *   --only <username>   seed just this profile (repeatable)
 *
 * Every seeded user signs in with SEED_PASSWORD below. Re-running is safe:
 * existing users are reused, and Items, budgets and preferences that already
 * exist are left alone. For a clean slate, recreate the database first.
 *
 * Safety: refuses any non-local database and any PLAID_ENV other than sandbox.
 */

import { config as loadEnv } from "dotenv";
import { databaseHost, isLocalHost } from "./backfill-guard";
import {
  buildProfiles,
  customConfig,
  MAX_CUSTOM_CONFIG_BYTES,
  type ItemSpec,
  type Profile,
} from "./seed-profiles";

/** Local-only test password (meets the app's password policy). */
export const SEED_PASSWORD = "Sandbox-pass1";

/** Same history window the app requests in Link (src/lib/plaid/link.ts). */
const DAYS_REQUESTED = 730;

function parseArgs(argv: string[]): { envFile: string | null; only: string[] } {
  const args = { envFile: null as string | null, only: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--env-file") args.envFile = next();
    else if (a === "--only") args.only.push(next());
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.envFile) loadEnv({ path: args.envFile, quiet: true });

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (use --env-file).");
  const host = databaseHost(url);
  if (!isLocalHost(host)) {
    throw new Error(`Refusing to seed non-local database host ${host}.`);
  }
  if (process.env.PLAID_ENV !== "sandbox") {
    throw new Error("Refusing to seed unless PLAID_ENV=sandbox.");
  }
  // Sign-up sends a verification email; never send it for seeded users.
  process.env.EMAIL_TRANSPORT = "console";
  console.log(`Seeding ${host}${new URL(url).pathname}`);

  // Imported after the guards so nothing connects before they pass.
  const { db } = await import("@/lib/db");
  const { and, count, eq, ilike, isNotNull, or } = await import("drizzle-orm");
  const { user } = await import("@/lib/db/schema/auth");
  const { plaidItems } = await import("@/lib/db/schema/plaid");
  const { transactions } = await import("@/lib/db/schema/transactions");
  const { financialAccounts } = await import("@/lib/db/schema/accounts");
  const { recurringStreams } = await import("@/lib/db/schema/recurring");
  const { budgets } = await import("@/lib/db/schema/budgets");
  const { userPreferences } = await import("@/lib/db/schema/user-preferences");
  const { auth } = await import("@/lib/auth/server");
  const { plaidClient } = await import("@/lib/plaid/client");
  const { exchangePublicToken } = await import("@/lib/plaid/link");
  const { syncItemNow } = await import("@/lib/plaid/jobs");
  const { decrypt } = await import("@/lib/utils/encryption");
  const { classifyTransaction, applySpendingClassifications } = await import("@/lib/spending/classify");
  const { recomputeUserFlowsLocked } = await import("@/lib/analytics/apply-flow-classes");
  const { isBuiltInBudgetKey } = await import("@/lib/budgets/categories");

  const DAY = 86_400_000;
  const today = new Date(new Date().toISOString().slice(0, 10));

  async function ensureUser(p: Profile): Promise<string> {
    const email = `${p.username}@finance.localhost`;
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    let id = row?.id;
    if (!id) {
      const res = await auth.api.signUpEmail({
        body: { email, password: SEED_PASSWORD, name: p.name, username: p.username },
      });
      id = res.user.id;
      console.log("  user created");
    }
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, id));
    if (p.timeZone) {
      await db
        .insert(userPreferences)
        .values({ userId: id, timeZone: p.timeZone })
        .onConflictDoNothing();
    }
    return id;
  }

  async function itemTransactionCount(itemRowId: string): Promise<number> {
    const [{ n }] = await db
      .select({ n: count() })
      .from(transactions)
      .innerJoin(financialAccounts, eq(transactions.accountId, financialAccounts.id))
      .where(eq(financialAccounts.plaidItemId, itemRowId));
    return n;
  }

  /**
   * Sync until the Item's history is in. The sandbox reports
   * HISTORICAL_UPDATE_COMPLETE before a custom user's older transactions
   * arrive, so for a custom Item wait for the generated count; for a persona
   * wait for the flag plus three syncs in a row that add nothing. Each manual
   * sync also refetches recurring streams, so the last one covers the full
   * history.
   */
  async function syncFully(itemRowId: string, expected: number | null): Promise<string> {
    let quiet = 0;
    for (let attempt = 1; attempt <= 40; attempt++) {
      const result = await syncItemNow(itemRowId);
      if (result.status === "done" && result.errorCode && result.errorCode !== "PRODUCT_NOT_READY") {
        return `stopped: ${result.errorCode}`;
      }
      const added = result.status === "done" ? result.totals.added : 0;
      quiet = added === 0 ? quiet + 1 : 0;
      const [item] = await db
        .select({ historical: plaidItems.historicalUpdateCompleteAt })
        .from(plaidItems)
        .where(eq(plaidItems.id, itemRowId));
      // A custom Item can also settle a little under its generated count
      // (Plaid may merge identical same-day rows), hence the quiet fallback.
      const done =
        (expected != null && (await itemTransactionCount(itemRowId)) >= expected) ||
        (item.historical != null && quiet >= (expected != null ? 5 : 3));
      if (done) {
        await syncItemNow(itemRowId); // recurring streams over the complete history
        return "complete";
      }
      await sleep(4_000);
    }
    return "history still loading; use Sync in Settings later";
  }

  async function linkItem(userId: string, spec: ItemSpec): Promise<void> {
    const config = spec.kind === "custom" ? customConfig(spec.accounts) : null;
    if (config && config.length > MAX_CUSTOM_CONFIG_BYTES) {
      throw new Error(
        `${spec.institutionId}: generated data is ${config.length} bytes (max ${MAX_CUSTOM_CONFIG_BYTES}); ` +
          "move some accounts to another Item or generate fewer transactions",
      );
    }
    const token = await plaidClient.sandboxPublicTokenCreate({
      institution_id: spec.institutionId,
      initial_products: ["transactions" as never],
      options: {
        override_username: spec.kind === "custom" ? "user_custom" : spec.plaidUser,
        override_password: config ?? "pass_good",
        transactions: { days_requested: DAYS_REQUESTED },
      },
    });
    const linked = await exchangePublicToken(token.data.public_token, userId, {
      institution: null,
      accounts: [],
    });
    const name = linked.institutionName ?? spec.institutionId;
    const expected =
      spec.kind === "custom" ? spec.accounts.reduce((n, a) => n + a.transactions.length, 0) : null;
    const status = await syncFully(linked.plaidItemId, expected);
    const n = await itemTransactionCount(linked.plaidItemId);
    console.log(`  linked ${name}: ${n} transactions, sync ${status}`);

    if (spec.kind === "custom" && spec.loginRequired) {
      const [item] = await db
        .select({ accessToken: plaidItems.accessToken })
        .from(plaidItems)
        .where(eq(plaidItems.id, linked.plaidItemId));
      await plaidClient.sandboxItemResetLogin({ access_token: decrypt(item.accessToken) });
      const res = await syncItemNow(linked.plaidItemId);
      const code = res.status === "done" ? res.errorCode : res.status;
      console.log(`  ${name}: login reset, next sync reports ${code ?? "no error"}`);
    }
  }

  /** A transaction of the user whose name or merchant contains `match`. */
  async function findTxn(userId: string, match: string, streamOnly = false) {
    const [row] = await db
      .select({ id: transactions.id, streamId: transactions.recurringStreamId })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          or(ilike(transactions.name, `%${match}%`), ilike(transactions.merchantName, `%${match}%`)),
          streamOnly ? isNotNull(transactions.recurringStreamId) : undefined,
        ),
      )
      .limit(1);
    if (!row) console.log(`  (no ${streamOnly ? "recurring " : ""}transaction matches "${match}"; skipped)`);
    return row;
  }

  async function applyExtras(userId: string, p: Profile): Promise<void> {
    if (p.budgets?.length) {
      const [{ n }] = await db.select({ n: count() }).from(budgets).where(eq(budgets.userId, userId));
      if (n === 0) {
        const unknown = p.budgets.filter((b) => !isBuiltInBudgetKey(b.categoryKey));
        if (unknown.length) throw new Error(`Unknown budget keys: ${unknown.map((b) => b.categoryKey).join(", ")}`);
        await db.insert(budgets).values(
          p.budgets.map((b) => ({
            userId,
            categoryKey: b.categoryKey,
            amount: b.amount.toFixed(2),
            period: b.period,
            startDate: new Date(today.getTime() - b.startDaysAgo * DAY),
          })),
        );
        console.log(`  ${p.budgets.length} budgets`);
      }
    }
    for (const r of p.spendingRules ?? []) {
      const txn = await findTxn(userId, r.merchant);
      if (txn) await classifyTransaction(userId, txn.id, r.spendingType, "merchant");
    }
    for (const s of p.streamTypes ?? []) {
      const txn = await findTxn(userId, s.match, true);
      if (txn) await classifyTransaction(userId, txn.id, s.spendingType, "stream");
    }
    for (const o of p.overrides ?? []) {
      const txn = await findTxn(userId, o.match);
      if (!txn) continue;
      // Mirrors the transaction edit dialog: a stream's override covers all its rows.
      const values = { customName: o.customName ?? null, customCategory: o.customCategory ?? null };
      if (txn.streamId) {
        await db
          .update(recurringStreams)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(recurringStreams.streamId, txn.streamId), eq(recurringStreams.userId, userId)));
        await db
          .update(transactions)
          .set(values)
          .where(and(eq(transactions.userId, userId), eq(transactions.recurringStreamId, txn.streamId)));
      } else {
        await db.update(transactions).set(values).where(eq(transactions.id, txn.id));
      }
    }
    if (p.overrides?.length) {
      // Categories feed flow classes, as after an edit in the app.
      const result = await recomputeUserFlowsLocked(userId);
      if (result.changedIds.length) await applySpendingClassifications(userId, result.changedIds);
    }
  }

  const profiles = buildProfiles().filter(
    (p) => args.only.length === 0 || args.only.includes(p.username),
  );

  for (const p of profiles) {
    console.log(`\n${p.username}: ${p.description}`);
    const userId = await ensureUser(p);

    const linked = new Set(
      (
        await db
          .select({ institutionId: plaidItems.institutionId })
          .from(plaidItems)
          .where(eq(plaidItems.userId, userId))
      ).map((r) => r.institutionId),
    );
    for (const spec of p.items) {
      if (linked.has(spec.institutionId)) {
        console.log(`  ${spec.institutionId} already linked; skipping`);
        continue;
      }
      await linkItem(userId, spec);
    }
    await applyExtras(userId, p);
  }

  console.log(`\nSign in at ${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"} with password ${SEED_PASSWORD}:`);
  for (const p of profiles) console.log(`  ${`${p.username}@finance.localhost`.padEnd(28)} ${p.description}`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "Seed failed");
    process.exit(1);
  });
