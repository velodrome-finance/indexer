import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** Every .ts file under `dir`, recursively. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * ADR 0003: token prices come from indexed pool state. The `getTokenPrice`
 * oracle effect stays exported for scripts, but nothing on the handler pricing
 * path may call it.
 */
describe("pricing path makes no oracle RPC", () => {
  const pricingPath = [
    ...tsFiles(join(SRC, "EventHandlers")),
    ...tsFiles(join(SRC, "Aggregators")),
    ...tsFiles(join(SRC, "Snapshots")),
    ...tsFiles(join(SRC, "Pricing")),
    join(SRC, "PriceOracle.ts"),
  ];

  it("covers a non-trivial set of files", () => {
    expect(pricingPath.length).toBeGreaterThan(50);
  });

  it("never references the getTokenPrice effect", () => {
    const offenders = pricingPath
      .filter((file) => /\bgetTokenPrice\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
