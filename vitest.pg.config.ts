import { defineConfig } from "vitest/config";

/**
 * Concurrency tests against a REAL Postgres (PGlite is single-connection, so
 * it cannot exercise leases, advisory locks or row-lock waits). Opt-in:
 *
 *   TEST_PG_URL=postgres://user:pass@127.0.0.1:54329/db pnpm exec vitest run --config vitest.pg.config.ts
 *
 * The database must already have the app schema; the tests only create and
 * delete their own synthetic rows. Refuses non-local hosts.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "pg",
    environment: "node",
    include: ["tests/pg/**/*.pg.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
