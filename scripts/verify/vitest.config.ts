import { defineConfig } from "vitest/config";

// Unit tests of the verification harness itself (not run by the repository's
// default `pnpm test`, whose include is test/**). Run with:
//   npx vitest run --config scripts/verify/vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["scripts/verify/test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
