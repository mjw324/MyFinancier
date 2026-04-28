import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "unit",
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
