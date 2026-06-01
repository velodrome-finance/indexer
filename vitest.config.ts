import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "threads",
    fileParallelism: true,
    testTimeout: 120_000,
    // Hooks default to 10s, but beforeEach/beforeAll here spin up createTestIndexer
    // workers and process events — the same heavy work as test bodies. Match testTimeout
    // so slow CI runners don't trip the 10s hook limit (envio v3.0.2 worker-thread setup).
    hookTimeout: 120_000,
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "generated/**",
        "**/node_modules/**",
        "**/*.d.ts",
        "src/Constants.ts",
        "src/CustomTypes.ts",
        "src/Pools/common.ts",
      ],
      reporter: ["text", "text-summary"],
    },
  },
});
