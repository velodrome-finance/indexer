import type { Token } from "envio";
import { createTestIndexer } from "envio";
import type { PublicClient } from "viem";
import type { MockInstance } from "vitest";
import {
  DEFAULT_SAMM_FEE_BPS,
  DEFAULT_VAMM_FEE_BPS,
  PoolId,
  RootPoolLeafPoolId,
  TokenId,
  toChecksumAddress,
} from "../../src/Constants";
import * as HelpersModule from "../../src/Effects/Helpers";
import type { Pool } from "../../src/EntityTypes";
import * as CrossChainPendingResolution from "../../src/EventHandlers/Voter/CrossChainPendingResolution";
import * as PriceOracle from "../../src/PriceOracle";
import { mutateChainConstants, simulateEvent } from "../testHelpers";
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
  const chainId = 10;

  let mockPriceOracle: MockInstance;

  /**
   * Helper function to reset and reconfigure the mockPriceOracle mock
   * This avoids repetition across multiple test cases
   */
  function resetMockPriceOracle(): void {
    mockPriceOracle.mockClear();
    mockPriceOracle.mockImplementation(async (...args) => {
      if (args[0] === token0Address) return mockToken0Data as Token;
      return mockToken1Data as Token;
    });
  }

  describe("PoolCreated event", () => {
    let createdPool: Pool | undefined;
    let chainConstantsCleanup: (() => void) | undefined;

    const fraxtalChainId = 252;
    const mockLpHelperAddress = toChecksumAddress(
      "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34",
    );

    beforeEach(async () => {
      vi.spyOn(HelpersModule, "sleep").mockResolvedValue(undefined);
      mockPriceOracle = vi.spyOn(PriceOracle, "createTokenEntity");
      resetMockPriceOracle();

      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });
      createdPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
    });

    afterEach(() => {
      vi.restoreAllMocks();
      // Restore CHAIN_CONSTANTS if it was mutated
      if (chainConstantsCleanup) {
        chainConstantsCleanup();
        chainConstantsCleanup = undefined;
      }
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should create token entities", () => {
      expect(mockPriceOracle).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least twice (once per token)
      expect(mockPriceOracle.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Issue #677 follow-up: when createTokenEntity returns null (bytecode
    // gate confirmed the address is a non-contract), no Pool
    // is created so we don't persist a pool pointing at a token row that was
    // deliberately not written. Uses a placeholder address for token0 that
    // has no on-chain bytecode on Optimism.
    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't
    // intercept the tsx-loaded hasContractBytecode effect (alpha.18), so this
    // would hit the public Optimism RPC and fail-open `true` on transient outages
    // (gate returns hasCode:true → token row created → assertion flips). Live
    // probe in the previous PR session confirmed the gate's correctness against
    // real RPCs; re-enable once effects are mockable under processEvents.
    it.skip("should skip Pool when token has no bytecode", async () => {
      const noBytecodeToken = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: noBytecodeToken as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });
      const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      expect(pool).toBeUndefined();
    });

    it("should continue when createTokenEntity rejects for one token", async () => {
      mockPriceOracle.mockImplementation(async (address: string) => {
        if (address === token0Address) {
          throw new Error("fetch failed");
        }
        return mockToken1Data as Token;
      });
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });
      const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      expect(pool).toBeDefined();
    });

    it("should create a new LiquidityPool entity and Token entities", async () => {
      expect(createdPool).toBeDefined();
      expect(createdPool?.isStable).toBe(false);
      expect(
        new Date(
          createdPool?.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(new Date(1000000 * 1000).getTime());
    });

    it("should appropriately set token data on the aggregator", () => {
      expect(createdPool?.token0_id).toBe(TokenId(chainId, token0Address));
      expect(createdPool?.token1_id).toBe(TokenId(chainId, token1Address));
      expect(createdPool?.token0_address).toBe(token0Address);
      expect(createdPool?.token1_address).toBe(token1Address);
    });

    it("should set baseFee and currentFee for non-CL pools (vAMM)", () => {
      // Non-CL pools should always have baseFee and currentFee set
      expect(createdPool?.baseFee).toBe(DEFAULT_VAMM_FEE_BPS);
      expect(createdPool?.currentFee).toBe(DEFAULT_VAMM_FEE_BPS);
    });

    it("should set factoryAddress to event.srcAddress for non-CL pools", async () => {
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });
      resetMockPriceOracle();
      const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      // srcAddress is set by the indexer harness — just verify factoryAddress is non-empty
      expect(pool?.factoryAddress).toBeTruthy();
    });

    // US-1 acceptance: V2 (non-CL) pools do not carry an NFPM — leave nfpmAddress unset.
    it("should leave nfpmAddress unset for non-CL (V2) pools", () => {
      expect(createdPool?.isCL).toBe(false);
      expect(createdPool?.nfpmAddress).toBeUndefined();
    });

    it("should set baseFee and currentFee for stable pools (sAMM)", async () => {
      resetMockPriceOracle();

      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: true, // Stable pool
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });
      const stablePool = await indexer.Pool.get(PoolId(chainId, poolAddress));

      // Stable pools should use DEFAULT_SAMM_FEE_BPS
      expect(stablePool?.baseFee).toBe(DEFAULT_SAMM_FEE_BPS);
      expect(stablePool?.currentFee).toBe(DEFAULT_SAMM_FEE_BPS);
    });

    it("should NOT create RootPool_LeafPool for Optimism (chainId 10)", async () => {
      resetMockPriceOracle();

      const indexer = createTestIndexer();
      await simulateEvent(indexer, 10, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Should not create RootPool_LeafPool for Optimism
      const rootPoolLeafPools = Array.from(
        await indexer.RootPool_LeafPool.getAll(),
      );
      expect(rootPoolLeafPools).toHaveLength(0);
    });

    it("should NOT create RootPool_LeafPool for Base (chainId 8453)", async () => {
      resetMockPriceOracle();

      const indexer = createTestIndexer();
      await simulateEvent(indexer, 8453, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Should not create RootPool_LeafPool for Base
      const rootPoolLeafPools = Array.from(
        await indexer.RootPool_LeafPool.getAll(),
      );
      expect(rootPoolLeafPools).toHaveLength(0);
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should create RootPool_LeafPool for non-Optimism/Base chains (e.g., Fraxtal)", async () => {
      const mockRootPoolAddress = toChecksumAddress(
        "0x98dcff98d17f21e35211c923934924af65fbdd66",
      );

      // Setup mock ethClient for Fraxtal
      const mockEthClient = {
        readContract: vi.fn().mockResolvedValue(mockRootPoolAddress),
      } as unknown as PublicClient;

      // Mock CHAIN_CONSTANTS for Fraxtal
      const { cleanup } = mutateChainConstants(fraxtalChainId, {
        eth_client: mockEthClient,
        lpHelperAddress: mockLpHelperAddress,
      });
      chainConstantsCleanup = cleanup;

      resetMockPriceOracle();

      const indexer = createTestIndexer();
      await simulateEvent(indexer, fraxtalChainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Should create RootPool_LeafPool for Fraxtal
      // The rootPoolAddress will be checksummed by the effect
      // ID format: rootChainId-leafChainId-rootPoolAddress-leafPoolAddress
      const expectedRootPoolAddress = toChecksumAddress(mockRootPoolAddress);
      const rootPoolLeafPoolId = RootPoolLeafPoolId(
        10,
        fraxtalChainId,
        expectedRootPoolAddress,
        poolAddress,
      );
      const rootPoolLeafPool =
        await indexer.RootPool_LeafPool.get(rootPoolLeafPoolId);

      expect(rootPoolLeafPool).toBeDefined();
      expect(rootPoolLeafPool?.rootChainId).toBe(10); // Always 10 (Optimism)
      expect(rootPoolLeafPool?.rootPoolAddress).toBe(expectedRootPoolAddress);
      expect(rootPoolLeafPool?.leafChainId).toBe(fraxtalChainId);
      expect(rootPoolLeafPool?.leafPoolAddress).toBe(poolAddress);

      // Verify the effect was called
      const mockReadContract = vi.mocked(mockEthClient.readContract);
      expect(mockReadContract).toHaveBeenCalledTimes(1);
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should handle error when getRootPoolAddress fails for non-Optimism/Base chains", async () => {
      // Setup mock ethClient that throws an error
      const mockEthClient = {
        readContract: vi.fn().mockRejectedValue(new Error("RPC call failed")),
      } as unknown as PublicClient;

      // Mock CHAIN_CONSTANTS for Fraxtal
      const { cleanup } = mutateChainConstants(fraxtalChainId, {
        eth_client: mockEthClient,
        lpHelperAddress: mockLpHelperAddress,
      });
      chainConstantsCleanup = cleanup;

      resetMockPriceOracle();

      const indexer = createTestIndexer();
      await simulateEvent(indexer, fraxtalChainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Should still create the pool even if root pool address fetch fails
      const createdPool = await indexer.Pool.get(
        PoolId(fraxtalChainId, poolAddress),
      );
      expect(createdPool).toBeDefined();

      // Should not create RootPool_LeafPool when effect fails (returns null/undefined)
      const rootPoolLeafPools = Array.from(
        await indexer.RootPool_LeafPool.getAll(),
      );
      // Note: The current implementation returns early if rootPoolAddress is falsy,
      // so we expect no RootPool_LeafPool to be created
      expect(rootPoolLeafPools).toHaveLength(0);
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should handle null/undefined rootPoolAddress from effect", async () => {
      // Setup mock ethClient that returns null
      // This will cause fetchRootPoolAddress to return empty string, which the handler should handle
      const mockEthClient = {
        readContract: vi.fn().mockResolvedValue(null),
      } as unknown as PublicClient;

      // Mock CHAIN_CONSTANTS for Fraxtal
      const { cleanup } = mutateChainConstants(fraxtalChainId, {
        eth_client: mockEthClient,
        lpHelperAddress: mockLpHelperAddress,
      });
      chainConstantsCleanup = cleanup;

      resetMockPriceOracle();

      const indexer = createTestIndexer();
      await simulateEvent(indexer, fraxtalChainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Should still create the pool
      const createdPool = await indexer.Pool.get(
        PoolId(fraxtalChainId, poolAddress),
      );
      expect(createdPool).toBeDefined();

      // Should not create RootPool_LeafPool when rootPoolAddress is null/undefined
      const rootPoolLeafPools = Array.from(
        await indexer.RootPool_LeafPool.getAll(),
      );
      expect(rootPoolLeafPools).toHaveLength(0);
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call flushPendingVotesAndDistributionsForRootPool when getRootPoolAddress returns address", async () => {
      const mockRootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );
      const rootChainId = 10;

      const mockEthClient = {
        readContract: vi.fn().mockResolvedValue(mockRootPoolAddress),
      } as unknown as PublicClient;
      const { cleanup } = mutateChainConstants(fraxtalChainId, {
        eth_client: mockEthClient,
        lpHelperAddress: mockLpHelperAddress,
      });
      chainConstantsCleanup = cleanup;

      resetMockPriceOracle();

      const flushSpy = vi.spyOn(
        CrossChainPendingResolution,
        "flushPendingVotesAndDistributionsForRootPool",
      );

      const indexer = createTestIndexer();
      await simulateEvent(indexer, fraxtalChainId, {
        contract: "PoolFactory",
        event: "PoolCreated",
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          stable: false,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      const expectedRootPoolAddress = toChecksumAddress(mockRootPoolAddress);
      const rootPoolLeafPoolId = RootPoolLeafPoolId(
        rootChainId,
        fraxtalChainId,
        expectedRootPoolAddress,
        poolAddress,
      );
      const rootPoolLeafPool =
        await indexer.RootPool_LeafPool.get(rootPoolLeafPoolId);
      expect(rootPoolLeafPool).toBeDefined();

      expect(flushSpy).toHaveBeenCalledWith(
        expect.anything(),
        expectedRootPoolAddress,
        "[PoolFactory.PoolCreated]",
      );
    });
  });

  describe("SetCustomFee event", () => {
    it("should update the Pool", async () => {
      // Setup - create a pool entity first
      const indexer = createTestIndexer();
      const existingPool = createMockPool({
        baseFee: undefined,
        currentFee: undefined,
        lastUpdatedTimestamp: new Date(900000 * 1000),
      });
      indexer.Pool.set(existingPool);

      const customFee = 500n; // 0.05% fee (500 basis points)
      const blockTimestamp = 2000000;
      await simulateEvent(indexer, 10, {
        contract: "PoolFactory",
        event: "SetCustomFee",
        params: {
          pool: poolAddress as `0x${string}`,
          fee: customFee,
        },
        block: {
          number: 2000000,
          timestamp: blockTimestamp,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Assert - check Pool was updated
      const updatedPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(customFee);
      expect(updatedPool?.currentFee).toBe(customFee);
      expect(
        new Date(
          updatedPool?.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(new Date(blockTimestamp * 1000).getTime());
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
      await simulateEvent(indexer, 10, {
        contract: "PoolFactory",
        event: "SetCustomFee",
        params: {
          pool: poolAddress as `0x${string}`,
          fee: newFee,
        },
        block: {
          number: 2000000,
          timestamp: blockTimestamp,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Assert - check fees were updated
      const updatedPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(newFee);
      expect(updatedPool?.currentFee).toBe(newFee);
      expect(updatedPool?.baseFee).not.toBe(existingFee);
      expect(
        new Date(
          updatedPool?.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(new Date(blockTimestamp * 1000).getTime());
    });

    it("should return early without updating pool if pool does not exist", async () => {
      // Setup - no pool entity in indexer
      const indexer = createTestIndexer();
      const nonExistentPoolAddress = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      await simulateEvent(indexer, 10, {
        contract: "PoolFactory",
        event: "SetCustomFee",
        params: {
          pool: nonExistentPoolAddress,
          fee: 100n,
        },
        block: {
          number: 2000000,
          timestamp: 2000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 2,
      });

      // Assert - Pool should not be updated
      const pool = await indexer.Pool.get(PoolId(10, nonExistentPoolAddress));
      expect(pool).toBeUndefined();
    });
  });
});
