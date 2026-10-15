import { afterAll, afterEach, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { pushSchema } from "drizzle-kit/api";
import * as schema from "@/lib/db/schema";
import { setTestDb } from "@/lib/db";

let pg: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

export function getTestDb() {
  return testDb;
}

beforeAll(async () => {
  pg = new PGlite();
  testDb = drizzle({ client: pg, schema });

  // Generate + apply schema directly from Drizzle schema (no migration drift).
  // pushSchema returns { apply, statementsToExecute, hasDataLoss, warnings }.
  const { apply } = await pushSchema(
    schema as unknown as Record<string, unknown>,
    // drizzle-kit/api is typed for postgres-js; PGlite Drizzle is structurally compatible.
    testDb as unknown as Parameters<typeof pushSchema>[1],
  );
  await apply();

  // Inject the PGlite-backed Drizzle instance so app code's `db` proxy uses it.
  setTestDb(testDb as unknown as Parameters<typeof setTestDb>[0]);
});

afterEach(async () => {
  // Truncate every public table so tests start clean. RESTART IDENTITY CASCADE
  // handles FK chains (transactions → accounts → plaid_items → user).
  await testDb.execute(sql`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
});

afterAll(async () => {
  setTestDb(null);
  await pg.close();
});

/** The underlying PGlite instance (e.g. to build a second, instrumented drizzle handle). */
export function getTestPg(): PGlite {
  return pg;
}

/**
 * Run `fn` with the app's `db` swapped for a drizzle handle on the same PGlite
 * database that counts every statement it issues. Restores the normal handle.
 */
export async function countStatements<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; statements: number; queries: string[] }> {
  const queries: string[] = [];
  const counting = drizzle({
    client: pg,
    schema,
    logger: { logQuery: (query: string) => void queries.push(query) },
  });
  setTestDb(counting as unknown as Parameters<typeof setTestDb>[0]);
  try {
    const result = await fn();
    return { result, statements: queries.length, queries };
  } finally {
    setTestDb(testDb as unknown as Parameters<typeof setTestDb>[0]);
  }
}

/** The PGlite db typed as the app's DbExecutor (structurally compatible at runtime). */
export function getTestExecutor(): import("@/lib/db").DbExecutor {
  return testDb as unknown as import("@/lib/db").DbExecutor;
}
