import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AERO_NFPM_ADDRESS,
  CHAIN_CONSTANTS,
  POOL_DEPLOYMENT,
  getLegacyConstants,
  legacyPoolDeployment,
  nfpmForCLPool,
  toChecksumAddress,
} from "../src/Constants";
import { getCanonicalSource } from "../src/PriceOverrides";
import { isConnectorToken } from "../src/PriceTrust";
import { PRICING_TIER, getPricingTier } from "../src/Pricing/PricingConfig";
import { createPoolSnapshot } from "../src/Snapshots/PoolSnapshot";
import { setupCommon } from "./EventHandlers/Pool/common";

/** chainId -> contract -> addresses, and chainId -> start_block, from config.yaml. */
function parseConfig(): {
  contracts: Map<number, Map<string, string[]>>;
  startBlocks: Map<number, number>;
} {
  const lines = fs
    .readFileSync(path.resolve(__dirname, "..", "config.yaml"), "utf8")
    .split("\n");
  const contracts = new Map<number, Map<string, string[]>>();
  const startBlocks = new Map<number, number>();
  let chain: number | null = null;
  let contract: string | null = null;
  for (const line of lines) {
    const c = line.match(/^ {2}- id:\s*(\d+)/);
    if (c) {
      chain = Number(c[1]);
      contracts.set(chain, new Map());
      contract = null;
      continue;
    }
    if (chain === null) continue;
    const sb = line.match(/^ {4}start_block:\s*(\d+)/);
    if (sb) startBlocks.set(chain, Number(sb[1]));
    const n = line.match(/^ {6}- name:\s*(\S+)/);
    if (n) {
      contract = n[1];
      contracts.get(chain)?.set(contract, []);
      continue;
    }
    const a = line.match(/^ {10}- (0x[0-9a-fA-F]{40})/);
    if (a && contract) {
      contracts.get(chain)?.get(contract)?.push(toChecksumAddress(a[1]));
    }
  }
  return { contracts, startBlocks };
}

const AERO_CHAINS = [8453, 10, 1, 42161, 57073, 4663, 5042] as const;
const AERO_ONLY_CHAINS = [1, 42161, 4663, 5042] as const;

describe("Aero deployment configuration (ADR 0005)", () => {
  const { contracts, startBlocks } = parseConfig();

  it.each(AERO_CHAINS)(
    "chain %i: every AeroCLFactory maps to an NFPM that config.yaml subscribes to",
    (chainId) => {
      const factories = contracts.get(chainId)?.get("AeroCLFactory") ?? [];
      const nfpms = contracts.get(chainId)?.get("AeroNFPM") ?? [];
      expect(factories.length).toBeGreaterThan(0);
      expect(nfpms).toContain(AERO_NFPM_ADDRESS);
      for (const factory of factories) {
        const nfpm = nfpmForCLPool(chainId, factory);
        expect(nfpm, `no NFPM for AeroCLFactory ${factory}`).not.toBeNull();
        expect(nfpms).toContain(nfpm);
      }
      for (const name of [
        "AeroStablePoolFactory",
        "AeroVolatilePoolFactory",
        "DynamicSwapFeeHook",
        "V2CustomFeeModule",
      ]) {
        expect(contracts.get(chainId)?.get(name)?.length).toBeGreaterThan(0);
      }
    },
  );

  it("indexes Arc's lite launch next to the full launch", () => {
    expect(contracts.get(5042)?.get("AeroCLFactory")).toHaveLength(2);
    expect(contracts.get(5042)?.get("AeroNFPM")).toHaveLength(2);
  });

  it.each(AERO_ONLY_CHAINS)(
    "Aero-only chain %i: aero constants, no legacy deployment, start_block = first Aero contract",
    (chainId) => {
      const c = CHAIN_CONSTANTS[chainId];
      expect(c.legacy).toBeUndefined();
      expect(c.aero).toBeDefined();
      expect(startBlocks.get(chainId)).toBe(c.aero?.startBlock);
      expect(() => getLegacyConstants(chainId)).toThrow(/no legacy/);
      // Only Aero contracts (plus the dynamic Pool / CLPool) are configured.
      for (const name of contracts.get(chainId)?.keys() ?? []) {
        expect(
          name.startsWith("Aero") ||
            [
              "DynamicSwapFeeHook",
              "V2CustomFeeModule",
              "Pool",
              "CLPool",
            ].includes(name),
          `${name} on Aero-only chain ${chainId}`,
        ).toBe(true);
      }
    },
  );

  it("Base, Optimism and Ink carry both deployments", () => {
    for (const chainId of [8453, 10, 57073]) {
      expect(CHAIN_CONSTANTS[chainId].legacy).toBeDefined();
      expect(CHAIN_CONSTANTS[chainId].aero).toBeDefined();
    }
  });

  it("names the legacy deployment by chain", () => {
    expect(legacyPoolDeployment(8453)).toBe(POOL_DEPLOYMENT.AERODROME);
    expect(legacyPoolDeployment(10)).toBe(POOL_DEPLOYMENT.VELODROME);
    expect(legacyPoolDeployment(57073)).toBe(POOL_DEPLOYMENT.VELODROME);
  });
});

describe("Aero pricing configuration", () => {
  const AERO_V1 = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
  const AERO = "0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee";

  it("keeps both AERO tokens on Base as tier-2 connectors, legacy reward token unchanged", () => {
    expect(getLegacyConstants(8453).rewardToken(Number.MAX_SAFE_INTEGER)).toBe(
      AERO_V1,
    );
    expect(CHAIN_CONSTANTS[8453].aero?.rewardToken).toBe(AERO);
    expect(getPricingTier(8453, AERO_V1)).toBe(PRICING_TIER.CONNECTOR);
    expect(getPricingTier(8453, AERO)).toBe(PRICING_TIER.CONNECTOR);
    expect(isConnectorToken(8453, AERO)).toBe(true);
  });

  it.each([
    [10, "0xbdEaeA5205d16f34Cb40038052d91235D87B4C54"],
    [42161, "0x436a085B2751cB87db270FFa66f8d698F87bEC82"],
    [5042, "0x20077cC0d5E385A0Fe9C91bbC7DC744f51559307"],
    [1, "0x9e148C5716b5aAdCFD3B71cEAE9EE7a9e22C29E2"],
    [57073, "0x9e148C5716b5aAdCFD3B71cEAE9EE7a9e22C29E2"],
    [4663, "0x9e148C5716b5aAdCFD3B71cEAE9EE7a9e22C29E2"],
  ])(
    "chain %i: xAERO %s is the Aero reward token, a connector, priced from Base AERO",
    (chainId, xaero) => {
      expect(CHAIN_CONSTANTS[chainId].aero?.rewardToken).toBe(xaero);
      expect(getPricingTier(chainId, xaero)).toBe(PRICING_TIER.CONNECTOR);
      expect(isConnectorToken(chainId, xaero)).toBe(true);
      expect(getCanonicalSource(chainId, xaero)).toEqual({
        chainId: 8453,
        address: AERO,
      });
    },
  );

  it("Arc: native USDC pinned, bridged WETH tier 1, EURC not pinned", () => {
    expect(
      getPricingTier(5042, "0x3600000000000000000000000000000000000000"),
    ).toBe(PRICING_TIER.PINNED);
    expect(
      getPricingTier(5042, "0x128cC466B61f542da60c70e3aA11c10e19B84EDB"),
    ).toBe(PRICING_TIER.WETH);
    expect(
      getPricingTier(5042, "0xbEF5f6D51CB62b58e6A8f77868681825C6FE21c1"),
    ).toBe(PRICING_TIER.OTHER);
  });

  it("Robinhood prices against USDG; Ethereum and Arbitrum against USDC", () => {
    expect(CHAIN_CONSTANTS[4663].destinationToken).toBe(
      "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    );
    expect(
      getPricingTier(1, "0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    ).toBe(PRICING_TIER.PINNED);
    expect(
      getPricingTier(42161, "0x004B506865409877C9fA29bfb1ebA929984B9bbC"),
    ).toBe(PRICING_TIER.PINNED);
  });

  it.each([
    [1, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"],
    [42161, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"],
    [4663, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"],
    [5042, "0x128cC466B61f542da60c70e3aA11c10e19B84EDB"],
  ])(
    "chain %i: WETH is the chain's weth and maps to Optimism WETH",
    (chainId, weth) => {
      expect(CHAIN_CONSTANTS[chainId].weth).toBe(weth);
      expect(getCanonicalSource(chainId, weth)).toEqual({
        chainId: 10,
        address: "0x4200000000000000000000000000000000000006",
      });
    },
  );
});

describe("PoolSnapshot.deployment", () => {
  it("copies the pool's deployment", () => {
    const { createMockPool } = setupCommon();
    const pool = createMockPool({ deployment: POOL_DEPLOYMENT.AERO });
    expect(createPoolSnapshot(pool, new Date(0), pool.chainId).deployment).toBe(
      POOL_DEPLOYMENT.AERO,
    );
  });
});
