import type { TokenPricingPools } from "envio";
import { createTestIndexer } from "envio";
import {
  DEFAULT_SAMM_FEE_BPS,
  DEFAULT_VAMM_FEE_BPS,
  PoolId,
  ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
  RootPoolLeafPoolId,
  TokenId,
  toCanonicalFeeScale,
  toChecksumAddress,
} from "../../src/Constants";
import { rehydrateTimestamps } from "../../src/EntityTimestamps";
import type { Pool } from "../../src/EntityTypes";
import { predictV2RootPoolAddress } from "../../src/EventHandlers/Voter/RootPoolLogic";
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
  // Base runs its own PoolFactory deployment; an event is only routed to a
  // contract when its source address is one configured for that chain.
  const basePoolFactoryAddress = toChecksumAddress(
    "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
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
    });
    idx.Token.set({
      ...mockToken1Data,
      id: TokenId(cid, token1Address),
      address: token1Address,
      chainId: cid,
    });
  }

  describe("PoolCreated event", () => {
    let createdPool: Pool | undefined;
    let token0PricingPools: TokenPricingPools | undefined;
    let token1PricingPools: TokenPricingPools | undefined;

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
                srcAddress: poolFactoryAddress,
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
      [token0PricingPools, token1PricingPools] = await Promise.all([
        indexer.TokenPricingPools.get(TokenId(chainId, token0Address)),
        indexer.TokenPricingPools.get(TokenId(chainId, token1Address)),
      ]);
    });

    it("registers the pool as a pricing candidate for WETH only (ADR 0003)", () => {
      // WETH (tier 1) / USDC.e (tier-0 stablecoin): only the higher tier gains it.
      expect(token0PricingPools?.pools).toEqual([PoolId(chainId, poolAddress)]);
      expect(token1PricingPools).toBeUndefined();
    });

    afterEach(() => {
      vi.restoreAllMocks();
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
                srcAddress: poolFactoryAddress,
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
      expect(pool?.factoryAddress).toBe(poolFactoryAddress);
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
                srcAddress: poolFactoryAddress,
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
                srcAddress: poolFactoryAddress,
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
                srcAddress: basePoolFactoryAddress,
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

    // Regression for #864 (FACTORY_POOL_COUNT_GAP). Before the fix, when the
    // #677 bytecode gate confirmed one token side was a non-contract,
    // createTokenEntity returned `null` and the V2 handler early-returned —
    // dropping the Pool entity even though the factory had authoritatively
    // registered it on-chain. The Base V2 audit found 3 pools missing this way.
    // Now: the gate still skips the Token row, but the Pool is persisted with
    // an empty symbol on the offending side.
    it("creates the Pool even when one token side is a non-contract (#864)", async () => {
      // 0x...dEaD is an EOA on Optimism; eth_getCode returns 0x so the bytecode
      // gate in createTokenEntity returns null for that side.
      const eoaTokenAddress = toChecksumAddress(
        "0x000000000000000000000000000000000000dEaD",
      );
      const indexer = createTestIndexer();
      // Only pre-seed token0 — token1 must traverse createTokenEntity/the gate.
      indexer.Token.set({
        ...mockToken0Data,
        id: TokenId(chainId, token0Address),
        address: token0Address,
        chainId,
      });

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "PoolCreated",
                srcAddress: poolFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: eoaTokenAddress as `0x${string}`,
                  pool: poolAddress as `0x${string}`,
                  stable: false,
                },
              },
            ],
          },
        },
      });

      const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      expect(pool).toBeDefined();
      // Pool keeps the on-chain token1 address; only the Token row is skipped.
      expect(pool?.token1_address).toBe(eoaTokenAddress);
      // No Token row created for the EOA side (the gate still wins there).
      const eoaToken = await indexer.Token.get(
        TokenId(chainId, eoaTokenAddress),
      );
      expect(eoaToken).toBeUndefined();
    });
  });

  // A superchain leaf V2 pool records its Optimism root pool on its own chain:
  // the V2 RootPoolFactory's CREATE2 address for (leaf chain, token0, token1,
  // stable), no RPC and no Optimism row (ADR 0009, flow D).
  describe("PoolCreated on a superchain leaf chain", () => {
    const metalChainId = 1750 as const;
    // The superchain leaf PoolFactory (same address on every leaf chain).
    const leafPoolFactoryAddress = toChecksumAddress(
      "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
    );
    // Metal oUSDT / WETH vAMM: its leaf LpHelper answered root_lp_address
    // 0xE96a48891686A15f7b55De3fCE9c97f412744A66 for this pair.
    const oUSDT = toChecksumAddress(
      "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    );
    const weth = toChecksumAddress(
      "0x4200000000000000000000000000000000000006",
    );
    const knownRootPool = toChecksumAddress(
      "0xE96a48891686A15f7b55De3fCE9c97f412744A66",
    );
    const leafPool = toChecksumAddress(
      "0x9999999999999999999999999999999999999991",
    );

    async function createLeafPool(stable: boolean) {
      const indexer = createTestIndexer();
      for (const [base, address] of [
        [mockToken0Data, oUSDT],
        [mockToken1Data, weth],
      ] as const) {
        indexer.Token.set({
          ...base,
          id: TokenId(metalChainId, address),
          address,
          chainId: metalChainId,
        });
      }
      await indexer.process({
        chains: {
          [metalChainId]: {
            simulate: [
              {
                contract: "PoolFactory",
                event: "PoolCreated",
                srcAddress: leafPoolFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: oUSDT as `0x${string}`,
                  token1: weth as `0x${string}`,
                  pool: leafPool as `0x${string}`,
                  stable,
                },
              },
            ],
          },
        },
      });
      return indexer;
    }

    it("writes RootPool_LeafPool with the root factory's CREATE2 address", async () => {
      const indexer = await createLeafPool(false);
      expect(
        predictV2RootPoolAddress(
          ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
          metalChainId,
          oUSDT,
          weth,
          false,
        ),
      ).toBe(knownRootPool);

      const rows = await indexer.RootPool_LeafPool.getAll();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: RootPoolLeafPoolId(10, metalChainId, knownRootPool, leafPool),
        chainId: metalChainId,
        rootChainId: 10,
        rootPoolAddress: knownRootPool,
        leafChainId: metalChainId,
        leafPoolAddress: leafPool,
      });
      expect(
        await indexer.Pool.get(PoolId(metalChainId, leafPool)),
      ).toBeDefined();
      // Nothing of the root chain is read or written from the leaf.
      expect(await indexer.RootPool.getAll()).toEqual([]);
    });

    it("uses the stable flag in the CREATE2 salt", async () => {
      const indexer = await createLeafPool(true);
      const stableRoot = predictV2RootPoolAddress(
        ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
        metalChainId,
        oUSDT,
        weth,
        true,
      );
      expect(stableRoot).not.toBe(knownRootPool);
      const rows = await indexer.RootPool_LeafPool.getAll();
      expect(rows.map((r) => r.id)).toEqual([
        RootPoolLeafPoolId(10, metalChainId, stableRoot, leafPool),
      ]);
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
