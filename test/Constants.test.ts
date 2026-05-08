import { describe, expect, it } from "vitest";
import {
  CHAIN_CONSTANTS,
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
  // `getManyRatesWithConnectors`. Lowercased per filter contract in
  // src/Effects/RpcGateway.ts.
  const OUSDT = "0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189";

  it("populates the OP V1/V2 poison set", () => {
    const set = CHAIN_CONSTANTS[10].oracle.v1v2ConnectorBlacklist;
    expect(set.has("0x01bff41798a0bcf287b996046ca68b395dbc1071")).toBe(true);
    expect(set.has(OUSDT)).toBe(true);
  });

  it("populates the Base V1/V2 poison set", () => {
    const set = CHAIN_CONSTANTS[8453].oracle.v1v2ConnectorBlacklist;
    expect(set.has(OUSDT)).toBe(true);
    expect(set.has("0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34")).toBe(true);
  });

  it("populates Mode and Fraxtal V2 poison sets with oUSDT", () => {
    expect(
      CHAIN_CONSTANTS[34443].oracle.v1v2ConnectorBlacklist.has(OUSDT),
    ).toBe(true);
    expect(CHAIN_CONSTANTS[252].oracle.v1v2ConnectorBlacklist.has(OUSDT)).toBe(
      true,
    );
  });

  it("leaves V3-only chains with an empty blacklist", () => {
    // Celo, Soneium, Unichain, Ink, Metal, Swell, Superseed never call V1/V2.
    for (const chainId of [42220, 1868, 130, 57073, 1750, 1923, 5330]) {
      expect(CHAIN_CONSTANTS[chainId].oracle.v1v2ConnectorBlacklist.size).toBe(
        0,
      );
    }
  });

  it("uses lowercase addresses (matches RpcGateway's case-insensitive compare)", () => {
    for (const chainId of [10, 8453, 34443, 252]) {
      for (const a of CHAIN_CONSTANTS[chainId].oracle.v1v2ConnectorBlacklist) {
        expect(a).toBe(a.toLowerCase());
      }
    }
  });
});
