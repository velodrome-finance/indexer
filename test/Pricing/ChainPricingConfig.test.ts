import { CHAIN_CONSTANTS } from "../../src/Constants";
import { PRICING_TIER, getPricingTier } from "../../src/Pricing/PricingConfig";
import pairings from "./fixtures/chain_pairings.json" with { type: "json" };

/**
 * Per-chain pricing-config audit (ADR 0006), against
 * `fixtures/chain_pairings.json`: every pool created by each chain's V2 / CL /
 * Aero factories, discovered over HyperSync on 2026-11-13, reduced to WETH's
 * pairs with configured tokens and each configured token's pool and lifetime
 * swap counts (swaps were not counted on Optimism and Base, whose pools are
 * too many; there the pool count is checked instead). Regenerate the fixture
 * when a chain is added or its pinned / connector config changes.
 */
type Counts = { pools: number; swaps: number | null };
type ChainPairings = {
  poolsDiscovered: number;
  swapsCounted: boolean;
  wethPairs: Record<string, Counts>;
  tokenPools: Record<string, Counts>;
};
const FIXTURE = pairings as unknown as Record<string, ChainPairings>;

/** Lifetime swaps a WETH / pinned pair must have shown to count as a route. */
const MIN_WETH_ROUTE_SWAPS = 1_000;

/**
 * Pinned tokens that legitimately have no pool on the chain yet. Anything else
 * pinned without a pool is treated as a wrong or dead entry.
 */
const KNOWN_UNUSED_PINNED: Record<number, Record<string, string>> = {
  130: {
    // Tether USD (USDT) on Unichain (`symbol()` / `name()` checked by RPC on
    // 2026-11-13): a real stablecoin with no Velodrome / Aero pool so far.
    "0x588ce4f028d8e7b53b687865d6a67b3a54c75518": "USDT, no pool yet",
  },
  42220: {
    // OpenUSDT at its superchain-wide address: no pool on Celo so far.
    "0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189": "oUSDT, no pool yet",
  },
};

const chains = Object.entries(CHAIN_CONSTANTS).map(
  ([id, c]) => [Number(id), c] as const,
);

describe("per-chain pricing configuration (audit fixture)", () => {
  it("has an audit entry for every configured chain", () => {
    expect(
      Object.keys(FIXTURE)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(chains.map(([id]) => id).sort((a, b) => a - b));
  });

  it.each(chains)("chain %i pins at least one stablecoin", (chainId, c) => {
    const pinned = [c.destinationToken, ...c.stablecoins].filter(
      (a) => getPricingTier(chainId, a) === PRICING_TIER.PINNED,
    );
    expect(pinned.length).toBeGreaterThan(0);
  });

  it.each(chains)(
    "chain %i: WETH trades against a pinned stablecoin",
    (chainId, c) => {
      const audit = FIXTURE[chainId];
      expect(getPricingTier(chainId, c.weth)).toBe(PRICING_TIER.WETH);
      const routes = Object.entries(audit.wethPairs).filter(
        ([address]) => getPricingTier(chainId, address) === PRICING_TIER.PINNED,
      );
      const best = Math.max(
        0,
        ...routes.map(([, n]) =>
          audit.swapsCounted ? (n.swaps ?? 0) : n.pools * MIN_WETH_ROUTE_SWAPS,
        ),
      );
      expect({ chainId, hasRoute: best >= MIN_WETH_ROUTE_SWAPS }).toEqual({
        chainId,
        hasRoute: true,
      });
    },
  );

  it.each(chains)(
    "chain %i: every pinned stablecoin has a pool (or is a known unused one)",
    (chainId, c) => {
      const audit = FIXTURE[chainId];
      const known = KNOWN_UNUSED_PINNED[chainId] ?? {};
      const unused = [c.destinationToken, ...c.stablecoins]
        .map((a) => a.toLowerCase())
        .filter((a) => (audit.tokenPools[a]?.pools ?? 0) === 0)
        .filter((a) => !(a in known));
      expect({ chainId, unused }).toEqual({ chainId, unused: [] });
    },
  );

  it("lists only pinned tokens as known unused", () => {
    for (const [chainId, entries] of Object.entries(KNOWN_UNUSED_PINNED)) {
      for (const address of Object.keys(entries)) {
        expect(getPricingTier(Number(chainId), address)).toBe(
          PRICING_TIER.PINNED,
        );
      }
    }
  });
});
