import type { Token } from "envio";
import { createTestIndexer } from "envio";
import type { PublicClient } from "viem";
import {
  DEFAULT_SAMM_FEE_BPS,
  DEFAULT_VAMM_FEE_BPS,
  PoolId,
  RootPoolLeafPoolId,
  TokenId,
  toCanonicalFeeScale,
  toChecksumAddress,
} from "../../src/Constants";
import { rehydrateTimestamps } from "../../src/EntityTimestamps";
import type { Pool } from "../../src/EntityTypes";
import * as CrossChainPendingResolution from "../../src/EventHandlers/Voter/CrossChainPendingResolution";
import { mutateChainConstants } from "../testHelpers";
import { setupCommon } from "./Pool/common";

describe("PoolFactory Events", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    createMockPool,
  } = setupCommon();
  const poolAddress = mockLiquidityPoolData.poolAddress;
  // Real Optimism contracts (WETH, USDC.e) so the #677 hasContractBytecode
  // gate doesn't short-circuit pool creation: eth_getCode returns bytecode
  // for both on the public RPC. The shared mockToken0Data/mockToken1Data
  // are still used for symbol/decimals data via the (no-op) createTokenEntity
  // spy below.
  const token0Address = toChecksumAddress(
    "0x4200000000000000000000000000000000000006",
  );
  const token1Address = toChecksumAddress(
    "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
  );
  const chainId = 10 as const;
  // Registered PoolFactory address for Optimism chain (from config.yaml)
  const poolFactoryAddress = toChecksumAddress(
    "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a",
  );

  /**
   * Pre-seed the pool's two Token entities so the PoolCreated handler finds them
   * already present and skips createTokenEntity. Otherwise createTokenEntity fires a
   * real RPC call inside the createTestIndexer worker thread (a main-thread vi.spyOn
   * is inert there), making these handler-state tests slow and network-dependent.
   *
   * @param idx - the test indexer to seed
   * @param cid - chain id the PoolCreated event is simulated on
   */
  function seedPoolTokens(
    idx: ReturnType<typeof createTestIndexer>,
    cid: number,
  ): void {
    idx.Token.set({
      ...mockToken0Data,
      id: TokenId(cid, token0Address),
      address: token0Address,
      chainId: cid,
    } as Token);
    idx.Token.set({
      ...mockToken1Data,
      id: TokenId(cid, token1Address),
      address: token1Address,
      chainId: cid,
    } as Token);
  }

  describe("PoolCreated event", () => {
    let createdPool: Pool | undefined;
    let chainConstantsCleanup: (() => void) | undefined;

    const fraxtalChainId = 252;
    const mockLpHelperAddress = toChecksumAddress(
      "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34",
    );

    beforeEach(async () => {
      const indexer = createTestIndexer();
      seedPoolTokens(indexer, chainId);
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "PoolCreated",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: token1Address as `0x${string}`,
                  pool: poolAddress as `0x${string}`,
                  stable: false,
                },
              },
            ],
          },
        },
      });
      const rawPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      createdPool = rawPool ? rehydrateTimestamps("Pool", rawPool) : undefined;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      // Restore CHAIN_CONSTANTS if it was mutated
      if (chainConstantsCleanup) {
        chainConstantsCleanup();
        chainConstantsCleanup = undefined;
      }
    });

    it("should create a new LiquidityPool entity and Token entities", async () => {
      expect(createdPool).toBeDefined();
      expect(createdPool?.isStable).toBe(false);
      expect(createdPool?.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should appropriately set token data on the aggregator", () => {
      expect(createdPool?.token0_id).toBe(TokenId(chainId, token0Address));
      expect(createdPool?.token1_id).toBe(TokenId(chainId, token1Address));
      expect(createdPool?.token0_address).toBe(token0Address);
      expect(createdPool?.token1_address).toBe(token1Address);
    });

    it("should set baseFee and currentFee for non-CL pools (vAMM)", () => {
      // V2 bps defaults are lifted to canonical FEE_SCALE (1e6) at write (#812).
      expect(createdPool?.baseFee).toBe(
        toCanonicalFeeScale(DEFAULT_VAMM_FEE_BPS, false),
      );
      expect(createdPool?.currentFee).toBe(
        toCanonicalFeeScale(DEFAULT_VAMM_FEE_BPS, false),
      );
    });

    it("should set factoryAddress to event.srcAddress for non-CL pools", async () => {
      const indexer = createTestIndexer();
      seedPoolTokens(indexer, chainId);
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "PoolCreated",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: token1Address as `0x${string}`,
                  pool: poolAddress as `0x${string}`,
                  stable: false,
                },
              },
            ],
          },
        },
      });
      const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      expect(pool?.factoryAddress).toBe(poolAddress);
    });

    // US-1 acceptance: V2 (non-CL) pools do not carry an NFPM — leave nfpmAddress unset.
    it("should leave nfpmAddress unset for non-CL (V2) pools", () => {
      expect(createdPool?.isCL).toBe(false);
      expect(createdPool?.nfpmAddress).toBeUndefined();
    });

    it("should set baseFee and currentFee for stable pools (sAMM)", async () => {
      const indexer = createTestIndexer();
      seedPoolTokens(indexer, chainId);
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "PoolCreated",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: token1Address as `0x${string}`,
                  pool: poolAddress as `0x${string}`,
                  stable: true, // Stable pool
                },
              },
            ],
          },
        },
      });
      const stablePool = await indexer.Pool.get(PoolId(chainId, poolAddress));

      // Stable pools use DEFAULT_SAMM_FEE_BPS, lifted to FEE_SCALE (#812)
      expect(stablePool?.baseFee).toBe(
        toCanonicalFeeScale(DEFAULT_SAMM_FEE_BPS, false),
      );
      expect(stablePool?.currentFee).toBe(
        toCanonicalFeeScale(DEFAULT_SAMM_FEE_BPS, false),
      );
    });

    it("should NOT create RootPool_LeafPool for Optimism (chainId 10)", async () => {
      const indexer = createTestIndexer();
      seedPoolTokens(indexer, chainId);
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "PoolCreated",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: token1Address as `0x${string}`,
                  pool: poolAddress as `0x${string}`,
                  stable: false,
                },
              },
            ],
          },
        },
      });

      // Should not create RootPool_LeafPool for Optimism
      const rootPoolLeafPools = await indexer.RootPool_LeafPool.getAll();
      expect(rootPoolLeafPools).toHaveLength(0);
    });

    it("should NOT create RootPool_LeafPool for Base (chainId 8453)", async () => {
      const baseChainId = 8453 as const;
      const indexer = createTestIndexer();
      seedPoolTokens(indexer, baseChainId);
      await indexer.process({
        chains: {
          [baseChainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "PoolCreated",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: token1Address as `0x${string}`,
                  pool: poolAddress as `0x${string}`,
                  stable: false,
                },
              },
            ],
          },
        },
      });

      // Should not create RootPool_LeafPool for Base
      const rootPoolLeafPools = await indexer.RootPool_LeafPool.getAll();
      expect(rootPoolLeafPools).toHaveLength(0);
    });
  });

  describe("SetCustomFee event", () => {
    it("should update the Pool", async () => {
      // Setup - create a pool entity first
      // Note: use 0n (not undefined) for BigInt! schema fields to avoid
      // snapshot serialization crash in createTestIndexer.
      const indexer = createTestIndexer();
      const existingPool = createMockPool({
        baseFee: 0n,
        currentFee: 0n,
        lastUpdatedTimestamp: new Date(900000 * 1000),
      });
      indexer.Pool.set(existingPool);

      const customFee = 500n; // 0.05% fee (500 basis points)
      const blockTimestamp = 2000000;

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "SetCustomFee",
                srcAddress: poolFactoryAddress,
                logIndex: 1,
                block: {
                  number: 2000000,
                  timestamp: blockTimestamp,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  pool: poolAddress as `0x${string}`,
                  fee: customFee,
                },
              },
            ],
          },
        },
      });

      // Assert - check Pool was updated
      const rawPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      const updatedPool = rawPool
        ? rehydrateTimestamps("Pool", rawPool)
        : undefined;
      expect(updatedPool).toBeDefined();
      // V2 SetCustomFee bps lifted to canonical FEE_SCALE (1e6) at write (#812)
      expect(updatedPool?.baseFee).toBe(toCanonicalFeeScale(customFee, false));
      expect(updatedPool?.currentFee).toBe(
        toCanonicalFeeScale(customFee, false),
      );
      expect(updatedPool?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
      // Verify other fields are preserved
      expect(updatedPool?.id).toBe(existingPool.id);
      expect(updatedPool?.chainId).toBe(existingPool.chainId);
      expect(updatedPool?.token0_address).toBe(existingPool.token0_address);
      expect(updatedPool?.token1_address).toBe(existingPool.token1_address);
    });

    it("should update existing fee values when pool already has fees set", async () => {
      // Setup - create a pool entity with existing fees
      const indexer = createTestIndexer();
      const existingFee = 300n;
      const existingPool = createMockPool({
        baseFee: existingFee,
        currentFee: existingFee,
        lastUpdatedTimestamp: new Date(900000 * 1000),
      });
      indexer.Pool.set(existingPool);

      const newFee = 750n;
      const blockTimestamp = 2000000;

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "SetCustomFee",
                srcAddress: poolFactoryAddress,
                logIndex: 1,
                block: {
                  number: 2000000,
                  timestamp: blockTimestamp,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  pool: poolAddress as `0x${string}`,
                  fee: newFee,
                },
              },
            ],
          },
        },
      });

      // Assert - check fees were updated
      const rawPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      const updatedPool = rawPool
        ? rehydrateTimestamps("Pool", rawPool)
        : undefined;
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(toCanonicalFeeScale(newFee, false));
      expect(updatedPool?.currentFee).toBe(toCanonicalFeeScale(newFee, false));
      expect(updatedPool?.baseFee).not.toBe(existingFee);
      expect(updatedPool?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should return early without updating pool if pool does not exist", async () => {
      // Setup - no pool entity in mock DB
      const indexer = createTestIndexer();
      const nonExistentPoolAddress = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "SetCustomFee",
                srcAddress: poolFactoryAddress,
                logIndex: 2,
                block: {
                  number: 2000000,
                  timestamp: 2000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  pool: nonExistentPoolAddress,
                  fee: 100n,
                },
              },
            ],
          },
        },
      });

      // Assert - Pool should not be updated
      const pool = await indexer.Pool.get(PoolId(10, nonExistentPoolAddress));
      expect(pool).toBeUndefined();
    });
  });
});
