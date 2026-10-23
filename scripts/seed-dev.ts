/**
 * Seed a LOCAL development database with verified users, each linked to a
 * Plaid sandbox persona and fully synced, so the dashboard has realistic data
 * without going through sign-up email or Plaid Link.
 *
 * Usage (tsx resolves the "@/..." aliases from tsconfig.json):
 *   pnpm db:seed
 *   pnpm dlx tsx@4.19.2 scripts/seed-dev.ts --env-file .env --only dynamic
 *
 * Options:
 *   --env-file <path>   load env from this file (nothing is loaded otherwise)
 *   --only <username>   seed just this user (repeatable)
 *
 * Every seeded user signs in with SEED_PASSWORD below. Re-running is safe:
 * existing users are reused and personas already linked are skipped.
 *
 * Safety: refuses any non-local database and any PLAID_ENV other than sandbox.
 */

import { config as loadEnv } from "dotenv";
import { databaseHost, isLocalHost } from "./backfill-guard";

/** Local-only test password (meets the app's password policy). */
export const SEED_PASSWORD = "Sandbox-pass1";

type Persona = {
  username: string;
  name: string;
  /** Plaid sandbox custom user (https://plaid.com/docs/sandbox/user-custom/). */
  plaidUser: string;
  institutionId: string;
  description: string;
};

const PERSONAS: Persona[] = [
  {
    username: "dynamic",
    name: "Dana Dynamic",
    plaidUser: "user_transactions_dynamic",
    institutionId: "ins_109508", // First Platypus Bank
    description: "realistic history + loans; new transactions on refresh",
  },
  {
    username: "yuppie",
    name: "Yuri Yuppie",
    plaidUser: "user_yuppie",
    institutionId: "ins_109508",
    description: "young-professional spending",
  },
  {
    username: "salaried",
    name: "Sal Bonus",
    plaidUser: "user_credit_bonus",
    institutionId: "ins_109508",
    description: "multiple salary streams with bonuses",
  },
  {
    username: "smallbiz",
    name: "Sam Business",
    plaidUser: "user_small_business",
    institutionId: "ins_109508",
    description: "small-business transactions",
  },
];

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
  const { eq, count } = await import("drizzle-orm");
  const { user } = await import("@/lib/db/schema/auth");
  const { plaidItems } = await import("@/lib/db/schema/plaid");
  const { transactions } = await import("@/lib/db/schema/transactions");
  const { auth } = await import("@/lib/auth/server");
  const { plaidClient } = await import("@/lib/plaid/client");
  const { exchangePublicToken } = await import("@/lib/plaid/link");
  const { syncItemNow } = await import("@/lib/plaid/jobs");

  const personas = args.only.length
    ? PERSONAS.filter((p) => args.only.includes(p.username))
    : PERSONAS;

  for (const p of personas) {
    const email = `${p.username}@finance.localhost`;
    console.log(`\n${p.username} (${p.plaidUser}: ${p.description})`);

    let [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!row) {
      const res = await auth.api.signUpEmail({
        body: { email, password: SEED_PASSWORD, name: p.name, username: p.username },
      });
      row = { id: res.user.id };
      console.log("  user created");
    }
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, row.id));

    const [{ n: itemCount }] = await db
      .select({ n: count() })
      .from(plaidItems)
      .where(eq(plaidItems.userId, row.id));
    if (itemCount > 0) {
      console.log("  already linked; skipping");
      continue;
    }

    const token = await plaidClient.sandboxPublicTokenCreate({
      institution_id: p.institutionId,
      initial_products: ["transactions" as never],
      options: { override_username: p.plaidUser, override_password: "pass_good" },
    });
    const linked = await exchangePublicToken(token.data.public_token, row.id, {
      institution: null,
      accounts: [],
    });
    console.log(`  linked ${linked.institutionName ?? "institution"}`);

    // The sandbox item's history can take a few seconds to become available.
    for (let attempt = 1; attempt <= 8; attempt++) {
      const result = await syncItemNow(linked.plaidItemId);
      const [{ n }] = await db
        .select({ n: count() })
        .from(transactions)
        .where(eq(transactions.userId, row.id));
      if (n > 0) {
        console.log(`  synced ${n} transactions`);
        break;
      }
      const code = result.status === "done" ? result.errorCode : result.status;
      if (attempt === 8) console.log(`  no transactions yet (${code ?? "empty"}); use Sync in Settings later`);
      else await sleep(5_000);
    }
  }

  console.log(`\nSign in at ${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"} with any of:`);
  for (const p of personas) console.log(`  ${p.username}@finance.localhost / ${SEED_PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "Seed failed");
    process.exit(1);
  });
