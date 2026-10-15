/**
 * Backfill: recompute transfer pairs and flow classes for every user's
 * non-manual transactions (pairs first, then classes), and keep the legacy
 * is_transfer / is_refund / refund_source flags in sync.
 *
 * Usage (tsx resolves the "@/..." aliases from tsconfig.json):
 *   pnpm dlx tsx@4.19.2 scripts/backfill-flow-classes.ts --env-file .env.local --dry-run
 *   pnpm dlx tsx@4.19.2 scripts/backfill-flow-classes.ts --env-file .env.local
 *
 * Options:
 *   --env-file <path>       load DATABASE_URL from this file (nothing is loaded otherwise)
 *   --dry-run               read-only: print per-class count/sum before → after, write nothing
 *   --user <id>             only this user (repeatable)
 *   --confirm-production    required when the database host is not local; you are then
 *                           shown the host and must type it back (or pass --confirm-host)
 *   --confirm-host <host>   non-interactive confirmation of the printed host
 *
 * Safety: refuses to touch a non-local database unless --confirm-production
 * is given AND the host is confirmed. Never prints credentials.
 */

import { createInterface } from "node:readline/promises";
import { config as loadEnv } from "dotenv";
import { assertTargetAllowed, databaseHost } from "./backfill-guard";

type Args = {
  envFile: string | null;
  dryRun: boolean;
  users: string[];
  confirmProduction: boolean;
  confirmHost: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { envFile: null, dryRun: false, users: [], confirmProduction: false, confirmHost: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--env-file") args.envFile = next();
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--user") args.users.push(next());
    else if (a === "--confirm-production") args.confirmProduction = true;
    else if (a === "--confirm-host") args.confirmHost = next();
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function confirmTarget(args: Args, host: string): Promise<void> {
  console.log(`Target database host: ${host}`);
  await assertTargetAllowed(host, {
    confirmProduction: args.confirmProduction,
    confirmHost: args.confirmHost,
    action: args.dryRun ? "dry-run" : "WRITE",
    ask: process.stdin.isTTY
      ? async (q) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return await rl.question(q);
          } finally {
            rl.close();
          }
        }
      : null,
  });
}

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.envFile) loadEnv({ path: args.envFile, quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (use --env-file).");
  await confirmTarget(args, databaseHost(url));

  // Imported after the guard so nothing connects before confirmation.
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { lockUserFlows, recomputeUserFlows } = await import("@/lib/analytics/apply-flow-classes");
  const { applySpendingClassifications } = await import("@/lib/spending/classify");
  const { FLOW_CLASSES } = await import("@/lib/analytics/flow");

  const userRows = (await db.execute(sql`SELECT id FROM "user" ORDER BY id`)) as unknown as
    | Array<{ id: string }>
    | { rows: Array<{ id: string }> };
  const allUsers = (Array.isArray(userRows) ? userRows : userRows.rows).map((r) => String(r.id));
  const users = args.users.length ? allUsers.filter((u) => args.users.includes(u)) : allUsers;
  console.log(`${args.dryRun ? "DRY RUN — " : ""}${users.length} user(s)`);

  for (const userId of users) {
    const result = await db.transaction(async (tx) => {
      if (args.dryRun) await tx.execute(sql`SET TRANSACTION READ ONLY`);
      else await lockUserFlows(tx, userId);
      return recomputeUserFlows(tx, userId, { dryRun: args.dryRun });
    });
    console.log(`\nuser ${userId.slice(0, 8)}…  rows ${result.scanned}`);
    console.log(
      `  pairs: ${args.dryRun ? "would create" : "created"} ${result.pairsCreated}, ` +
        `${args.dryRun ? "would clear" : "cleared"} ${result.pairsCleared}` +
        (result.pairsFailed ? `, failed ${result.pairsFailed}` : ""),
    );
    console.log(`  rows ${args.dryRun ? "that would change" : "updated"}: ${args.dryRun ? result.changedIds.length : result.updated}`);
    console.log(`  class                    before (n · sum)            after (n · sum)`);
    const keys = new Set([...Object.keys(result.before), ...Object.keys(result.after)]);
    const ordered = [...FLOW_CLASSES, "(null)"].filter((k) => keys.has(k));
    for (const k of ordered) {
      const b = result.before[k] ?? { count: 0, cents: 0 };
      const a = result.after[k] ?? { count: 0, cents: 0 };
      const mark = b.count !== a.count || b.cents !== a.cents ? " *" : "";
      console.log(
        `  ${k.padEnd(24)} ${String(b.count).padStart(5)} · ${money(b.cents).padStart(14)}    ${String(a.count).padStart(5)} · ${money(a.cents).padStart(14)}${mark}`,
      );
    }
    if (!args.dryRun && result.changedIds.length) {
      await applySpendingClassifications(userId, result.changedIds);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "Backfill failed");
    process.exit(1);
  });
