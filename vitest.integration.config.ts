import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "integration",
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup/pglite.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
