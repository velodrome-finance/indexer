import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAIN_CONSTANTS,
  ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
  SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
  SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST,
  VOTER_CLPOOLS_FACTORY_LIST,
  VOTER_NONCL_POOLS_FACTORY_LIST,
  nfpmForCLPool,
  toChecksumAddress,
} from "../src/Constants";

describe("nfpmForCLPool", () => {
  const OP_CL_FACTORY_OLD = toChecksumAddress(
    "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
  );
  const OP_CL_FACTORY_NEW = toChecksumAddress(
    "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F",
  );
  const OP_NFPM_OLD = toChecksumAddress(
    "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
  );
  const OP_NFPM_NEW = toChecksumAddress(
    "0x416b433906b1B72FA758e166e239c43d68dC6F29",
  );

  const BASE_CL_FACTORY_OLD = toChecksumAddress(
    "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
  );
  const BASE_CL_FACTORY_NEW = toChecksumAddress(
    "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a",
  );
  const BASE_CL_FACTORY_V3 = toChecksumAddress(
    "0x9592CD9B267748cbfBDe90Ac9F7DF3c437A6d51B",
  );
  const BASE_CL_FACTORY_V3_NEWEST = toChecksumAddress(
    "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef",
  );
  const BASE_NFPM_OLD = toChecksumAddress(
    "0x827922686190790b37229fd06084350E74485b72",
  );
  const BASE_NFPM_NEW = toChecksumAddress(
    "0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F",
  );
  const BASE_NFPM_V3 = toChecksumAddress(
    "0xc741beb2156827704A1466575ccA1cBf726a1178",
  );

  const SUPERCHAIN_CL_FACTORY = toChecksumAddress(
    "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
  );
  const SUPERCHAIN_NFPM = toChecksumAddress(
    "0x991d5546C4B442B4c5fdc4c8B8b8d131DEB24702",
  );

  it("disambiguates Optimism's two CLFactories to distinct NFPMs", () => {
    expect(nfpmForCLPool(10, OP_CL_FACTORY_OLD)).toBe(OP_NFPM_OLD);
    expect(nfpmForCLPool(10, OP_CL_FACTORY_NEW)).toBe(OP_NFPM_NEW);
  });

  it("pairs Base CLFactories with their respective NFPMs", () => {
    expect(nfpmForCLPool(8453, BASE_CL_FACTORY_OLD)).toBe(BASE_NFPM_OLD);
    expect(nfpmForCLPool(8453, BASE_CL_FACTORY_NEW)).toBe(BASE_NFPM_NEW);
    expect(nfpmForCLPool(8453, BASE_CL_FACTORY_V3)).toBe(BASE_NFPM_V3);
  });

  it("returns null for the newest Base CLFactory pending NFPM deployment", () => {
    // 0xf8f2eB... ships without a paired NFPM yet; callers should treat null
    // as "unknown" and skip attribution until the mapping is filled in.
    expect(nfpmForCLPool(8453, BASE_CL_FACTORY_V3_NEWEST)).toBeNull();
  });

  // Every superchain leaf shares the same CLFactory↔NFPM pair
  it.each([1135, 34443, 42220, 1868, 130, 252, 57073, 1750, 1923, 5330])(
    "returns the superchain NFPM for leaf chain %i",
    (chainId) => {
      expect(nfpmForCLPool(chainId, SUPERCHAIN_CL_FACTORY)).toBe(
        SUPERCHAIN_NFPM,
      );
    },
  );

  it("accepts lowercase factory addresses (checksums internally)", () => {
    expect(nfpmForCLPool(10, OP_CL_FACTORY_OLD.toLowerCase())).toBe(
      OP_NFPM_OLD,
    );
  });

  it("returns null for unknown (chainId, factory) pairs", () => {
    expect(
      nfpmForCLPool(
        10,
        toChecksumAddress("0x0000000000000000000000000000000000000001"),
      ),
    ).toBeNull();
    // Optimism factory on wrong chain
    expect(nfpmForCLPool(8453, OP_CL_FACTORY_OLD)).toBeNull();
  });
});

describe("oracle.v1v2ConnectorBlacklist (#688)", () => {
  // Empirically determined connectors that revert V1/V2
  // `getManyRatesWithConnectors`. Casing matches price_connectors.json so the
  // case-sensitive filter in src/Effects/RpcGateway.ts strikes them.
  const OUSDT = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";

  it("populates the OP V1/V2 poison set", () => {
    const set = CHAIN_CONSTANTS[10].oracle.v1v2ConnectorBlacklist;
    expect(set.has("0x01bFF41798a0BcF287b996046Ca68b395DbC1071")).toBe(true);
    expect(set.has(OUSDT)).toBe(true);
  });

  it("populates the Base V1/V2 poison set", () => {
    const set = CHAIN_CONSTANTS[8453].oracle.v1v2ConnectorBlacklist;
    expect(set.has(OUSDT)).toBe(true);
    // 0x5d3a1Ff... is in the priceConnectors list but works individually on
    // both V1 and V2 — the discriminator probe shows dropping oUSDT alone is
    // sufficient. Keep this address out of the blacklist.
    expect(set.has("0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34")).toBe(false);
  });

  it("populates the Mode V2 poison set with oUSDT", () => {
    expect(
      CHAIN_CONSTANTS[34443].oracle.v1v2ConnectorBlacklist.has(OUSDT),
    ).toBe(true);
  });

  it("leaves Fraxtal's V2 blacklist empty after dropping oUSDT (#764)", () => {
    // Fraxtal no longer lists 0x1217… as a price connector — the contract at
    // that address on Fraxtal is not canonical oUSDT — so there is nothing
    // for the V1/V2 blacklist to strip.
    expect(CHAIN_CONSTANTS[252].oracle.v1v2ConnectorBlacklist.size).toBe(0);
    expect(
      CHAIN_CONSTANTS[252].oracle.priceConnectors.some(
        (c) => c.address === OUSDT,
      ),
    ).toBe(false);
  });

  it("leaves V3-only chains with an empty blacklist", () => {
    // Celo, Soneium, Unichain, Ink, Metal, Swell, Superseed never call V1/V2.
    for (const chainId of [42220, 1868, 130, 57073, 1750, 1923, 5330]) {
      expect(CHAIN_CONSTANTS[chainId].oracle.v1v2ConnectorBlacklist.size).toBe(
        0,
      );
    }
  });

  it("uses casing that matches the chain's priceConnectors entries", () => {
    // RpcGateway compares with `!==` (case-sensitive), so every blacklist
    // entry must be present verbatim in priceConnectors to actually filter.
    for (const chainId of [10, 8453, 34443, 252]) {
      const chain = CHAIN_CONSTANTS[chainId];
      const known = new Set(chain.oracle.priceConnectors.map((c) => c.address));
      for (const a of chain.oracle.v1v2ConnectorBlacklist) {
        expect(known.has(a)).toBe(true);
      }
    }
  });
});

/**
 * Parses config.yaml's `chains[]` blocks into a `chainId -> contractName -> addresses[]`
 * map of checksummed addresses. Used by the parity assertions below (#770) to detect
 * drift between config.yaml and address-tied constants in src/Constants.ts.
 *
 * Hand-rolled rather than pulling in a YAML dep because config.yaml's chain blocks
 * use a uniform 2/6/8/10-space indentation and we only need address bullets.
 *
 * @returns Nested map keyed first by chain ID, then by contract name (e.g. "CLFactory")
 */
function parseConfigYamlAddresses(): Map<number, Map<string, string[]>> {
  const configPath = path.resolve(__dirname, "..", "config.yaml");
  const lines = fs.readFileSync(configPath, "utf8").split("\n");

  const chainHeaderRe = /^ {2}- id:\s*(\d+)/;
  const contractNameRe = /^ {6}- name:\s*(\S+)/;
  const bulletRe = /^ {10}- (0x[0-9a-fA-F]{40})/;

  const result = new Map<number, Map<string, string[]>>();
  let currentChain: Map<string, string[]> | null = null;
  let currentContract: string | null = null;

  for (const line of lines) {
    const chainMatch = line.match(chainHeaderRe);
    if (chainMatch) {
      const chainId = Number(chainMatch[1]);
      currentChain = new Map();
      currentContract = null;
      result.set(chainId, currentChain);
      continue;
    }
    if (!currentChain) continue;

    const nameMatch = line.match(contractNameRe);
    if (nameMatch) {
      currentContract = nameMatch[1];
      if (!currentChain.has(currentContract)) {
        currentChain.set(currentContract, []);
      }
      continue;
    }

    if (currentContract) {
      const addrMatch = line.match(bulletRe);
      if (addrMatch) {
        currentChain
          .get(currentContract)
          ?.push(toChecksumAddress(addrMatch[1]));
      }
    }
  }

  return result;
}

describe("config.yaml ↔ Constants.ts factory parity (#770, subsumes #769)", () => {
  const SUPERCHAIN_LEAF_CHAIN_IDS = [
    42220, 1868, 57073, 34443, 1135, 130, 252, 1750, 5330, 1923,
  ] as const;

  const configByChain = parseConfigYamlAddresses();

  /**
   * Asserts every config.yaml address for `(chainId, contractName)` is present in
   * `constant`. Reports the first missing entry with the constant name, chain ID,
   * and address so the failure message tells you exactly which list to update.
   */
  function assertCoverage(
    chainId: number,
    contractName: string,
    constantName: string,
    constant: readonly string[],
    whitelist: ReadonlySet<string> = new Set(),
  ) {
    const expected = configByChain.get(chainId)?.get(contractName) ?? [];
    expect(
      expected.length,
      `config.yaml has no ${contractName} entries for chain ${chainId} — parser broken or chain removed`,
    ).toBeGreaterThan(0);
    for (const address of expected) {
      if (whitelist.has(address)) continue;
      expect(
        constant,
        `missing in ${constantName}: ${address} (chain ${chainId}) — add to src/Constants.ts to keep config.yaml in sync`,
      ).toContain(address);
    }
  }

  it.each([
    [10, "Optimism"],
    [8453, "Base"],
  ])("VOTER_CLPOOLS_FACTORY_LIST covers chain %s (%s) CLFactories", (id) => {
    assertCoverage(
      id as number,
      "CLFactory",
      "VOTER_CLPOOLS_FACTORY_LIST",
      VOTER_CLPOOLS_FACTORY_LIST,
    );
  });

  it.each([
    [10, "Optimism"],
    [8453, "Base"],
  ])(
    "VOTER_NONCL_POOLS_FACTORY_LIST covers chain %s (%s) PoolFactories",
    (id) => {
      assertCoverage(
        id as number,
        "PoolFactory",
        "VOTER_NONCL_POOLS_FACTORY_LIST",
        VOTER_NONCL_POOLS_FACTORY_LIST,
      );
    },
  );

  it.each(SUPERCHAIN_LEAF_CHAIN_IDS.map((id) => [id]))(
    "SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST covers leaf chain %i CLFactories",
    (id) => {
      assertCoverage(
        id,
        "CLFactory",
        "SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST",
        SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
      );
    },
  );

  it.each(SUPERCHAIN_LEAF_CHAIN_IDS.map((id) => [id]))(
    "SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST covers leaf chain %i PoolFactories",
    (id) => {
      assertCoverage(
        id,
        "PoolFactory",
        "SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST",
        SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST,
      );
    },
  );

  it("ROOT_POOL_FACTORY_ADDRESS_OPTIMISM stays in sync with the superchain non-CL factory", () => {
    // The constant's name is historical; semantically it is the non-CL pool factory
    // used in cross-chain root↔leaf V2 lookups (getRootPoolAddress in PoolFactory.ts).
    // The same address appears as `PoolFactory.address` on every superchain leaf chain,
    // so we assert internal consistency against SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST
    // — that list itself is checked against config.yaml above.
    expect(
      SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST,
      "ROOT_POOL_FACTORY_ADDRESS_OPTIMISM diverged from SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST",
    ).toContain(ROOT_POOL_FACTORY_ADDRESS_OPTIMISM);
  });

  describe("nfpmForCLPool covers every (chainId, CLFactory) pair", () => {
    // Some CLFactories are wired into config.yaml but don't yet have a paired NFPM
    // declared in CL_FACTORY_TO_NFPM. They resolve to `null` from nfpmForCLPool;
    // callers treat null as "unknown" and skip NFPM attribution for those pools.
    //
    // Each entry below records *why* the gap is currently tolerated. Resolve by
    // adding the (chainId, factory) -> NFPM mapping in src/Constants.ts and
    // removing the entry from this allowlist.
    const UNMAPPED_CL_FACTORIES_BY_CHAIN: Record<number, Set<string>> = {
      // Base: newest CLFactory (paired with CLGaugeFactoryV3). The matching NFPM
      // 0xe1f8cd9A… is in config.yaml but has not yet been declared in
      // CL_FACTORY_TO_NFPM. See TODO(nfpm) in src/Constants.ts.
      8453: new Set([
        toChecksumAddress("0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef"),
      ]),
      // Optimism: slipstream gauge-V2 CLFactory added in #727. Likely pairs with
      // the third OP NFPM (0xf7f8ccce…) but the pairing has not been on-chain
      // verified via NFPM.factory(), so it is left unmapped.
      10: new Set([
        toChecksumAddress("0xe13Dd1fbA721Aa81a1826D9523AC9BC7d260c879"),
      ]),
    };
    // Superchain leaves: slipstream gauge-V2 CLFactory deployed at
    // 0x718E46d… on every leaf (#727). Likely pairs with the second leaf NFPM
    // 0xefD0f78F…; unverified, so currently unmapped.
    const UNMAPPED_SUPERCHAIN_CL_FACTORIES = new Set<string>([
      toChecksumAddress("0x718E46d0962A66942E233760a8bd6038Ce54EdCD"),
    ]);

    it.each([10, 8453, ...SUPERCHAIN_LEAF_CHAIN_IDS])(
      "every CLFactory on chain %i is either mapped or explicitly unmapped",
      (chainId) => {
        const factories = configByChain.get(chainId)?.get("CLFactory") ?? [];
        expect(
          factories.length,
          `config.yaml has no CLFactory entries for chain ${chainId}`,
        ).toBeGreaterThan(0);

        const chainWhitelist =
          UNMAPPED_CL_FACTORIES_BY_CHAIN[chainId] ??
          (SUPERCHAIN_LEAF_CHAIN_IDS.includes(
            chainId as (typeof SUPERCHAIN_LEAF_CHAIN_IDS)[number],
          )
            ? UNMAPPED_SUPERCHAIN_CL_FACTORIES
            : new Set<string>());

        for (const factory of factories) {
          const mapped = nfpmForCLPool(chainId, factory);
          if (mapped !== null) continue;
          expect(
            chainWhitelist,
            `nfpmForCLPool returned null for chain ${chainId} factory ${factory} — add the (chainId, factory) -> NFPM mapping to CL_FACTORY_TO_NFPM in src/Constants.ts, or whitelist with a comment`,
          ).toContain(factory);
        }
      },
    );
  });
});
