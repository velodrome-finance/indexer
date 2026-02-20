import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "threads",
    fileParallelism: true,
    testTimeout: 120_000,
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
