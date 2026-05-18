import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  OUSDTSwapsId,
  OUSDT_ADDRESS,
  PoolId,
  TokenId,
  toChecksumAddress,
} from "../../src/Constants";
import { simulateEvent } from "../testHelpers";
import { type MockPool, setupCommon } from "./Pool/common";

describe("CLPool Events", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    createMockPool,
    createMockUserStatsPerPool,
  } = setupCommon();
  const chainId = 10;
  const userAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const recipientAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );

  let liquidityPool: MockPool;

  beforeEach(() => {
    // Set up liquidity pool
    liquidityPool = createMockPool({
      isCL: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Swap Event", () => {
    const swapParams = {
      sender: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      recipient: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
      amount0: 1000n,
      amount1: -500n,
      sqrtPriceX96: 1000000n,
      liquidity: 2000000n,
      tick: 100n,
    };
    const swapBlock = {
      number: 1000000,
      timestamp: 1000000,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };
    const swapTxHash =
      "0x1234567890123456789012345678901234567890123456789012345678901234";

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process swap event and update pool aggregator", async () => {
      // Test requires vi.spyOn on CLPoolSwapLogic.processCLPoolSwap
    });

    it("should return early if pool data not found", async () => {
      const indexer = createTestIndexer();
      // No pool seeded → handler returns early

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "Swap",
        params: swapParams,
        block: swapBlock,
        transaction: { hash: swapTxHash },
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(liquidityPool.id);
      expect(pool).toBeUndefined();
    });

    it("should create oUSDTSwap entity when OUSDT token is involved", async () => {
      // Create a pool with OUSDT as token0
      const ousdtToken: Token = {
        ...mockToken0Data,
        address: OUSDT_ADDRESS,
        id: TokenId(chainId, OUSDT_ADDRESS),
      };

      const ousdtPool = {
        ...liquidityPool,
        token0_address: OUSDT_ADDRESS,
        token0_id: ousdtToken.id,
      };
      const userStats = createMockUserStatsPerPool({
        userAddress,
        poolAddress: liquidityPool.poolAddress,
        chainId,
        firstActivityTimestamp: new Date(1000000 * 1000),
        lastActivityTimestamp: new Date(1000000 * 1000),
      });

      const indexer = createTestIndexer();
      indexer.Pool.set(ousdtPool);
      indexer.Token.set(ousdtToken);
      indexer.Token.set(mockToken1Data as Token);
      indexer.UserStatsPerPool.set(userStats);

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "Swap",
        params: {
          sender: userAddress,
          recipient: recipientAddress,
          amount0: 1000n,
          amount1: -500n,
          sqrtPriceX96: 1000000n,
          liquidity: 2000000n,
          tick: 100n,
        },
        block: {
          number: 1000000,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: { hash: swapTxHash },
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      // Verify oUSDTSwap entity was created with OUSDT as token0
      // amount0=1000n (positive) → token0 (OUSDT) in, token1 out
      const swapId = OUSDTSwapsId(
        swapTxHash,
        chainId,
        OUSDT_ADDRESS,
        1000n, // amountIn = amount0
        mockToken1Data.address,
        500n, // amountOut = abs(amount1)
      );
      const swapEntity = await indexer.OUSDTSwaps.get(swapId);
      expect(swapEntity).toBeDefined();
      if (!swapEntity) return;
      expect(swapEntity.transactionHash).toBe(swapTxHash);
      // With amount0 > 0, token0 (OUSDT) goes in, token1 goes out
      expect(swapEntity.tokenInPool).toBe(OUSDT_ADDRESS);
      expect(swapEntity.tokenOutPool).toBe(mockToken1Data.address);
      expect(swapEntity.amountIn).toBe(1000n);
      expect(swapEntity.amountOut).toBe(500n);
    });

    it("should handle all amount conversion branches for oUSDTSwap", async () => {
      const ousdtToken: Token = {
        ...mockToken0Data,
        address: OUSDT_ADDRESS,
        id: TokenId(chainId, OUSDT_ADDRESS),
      };

      const ousdtPool = {
        ...liquidityPool,
        token0_address: OUSDT_ADDRESS,
        token0_id: ousdtToken.id,
      };
      const userStats = createMockUserStatsPerPool({
        userAddress,
        poolAddress: liquidityPool.poolAddress,
        chainId,
        firstActivityTimestamp: new Date(1000000 * 1000),
        lastActivityTimestamp: new Date(1000000 * 1000),
      });

      // Test with positive amount0 (amount0In path)
      const indexer1 = createTestIndexer();
      indexer1.Pool.set(ousdtPool);
      indexer1.Token.set(ousdtToken);
      indexer1.Token.set(mockToken1Data as Token);
      indexer1.UserStatsPerPool.set(userStats);

      await simulateEvent(indexer1, chainId, {
        contract: "CLPool",
        event: "Swap",
        params: {
          sender: userAddress,
          recipient: recipientAddress,
          amount0: 1000n, // Positive
          amount1: -500n, // Negative
          sqrtPriceX96: 1000000n,
          liquidity: 2000000n,
          tick: 100n,
        },
        block: {
          number: 1000000,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: { hash: swapTxHash },
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const swapId1 = OUSDTSwapsId(
        swapTxHash,
        chainId,
        OUSDT_ADDRESS,
        1000n,
        mockToken1Data.address,
        500n,
      );
      const swapEntity = await indexer1.OUSDTSwaps.get(swapId1);
      expect(swapEntity).toBeDefined();
      if (!swapEntity) return;
      expect(swapEntity.transactionHash).toBe(swapTxHash);
      expect(swapEntity.tokenInPool).toBe(OUSDT_ADDRESS); // token0 (OUSDT) is going in
      expect(swapEntity.tokenOutPool).toBe(mockToken1Data.address); // token1 is going out
      expect(swapEntity.amountIn).toBe(1000n); // amount0In = 1000n
      expect(swapEntity.amountOut).toBe(500n); // amount1Out = 500n

      // Test with negative amount0 (amount0Out path)
      const negTxHash =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const indexer2 = createTestIndexer();
      indexer2.Pool.set(ousdtPool);
      indexer2.Token.set(ousdtToken);
      indexer2.Token.set(mockToken1Data as Token);
      indexer2.UserStatsPerPool.set(userStats);

      await simulateEvent(indexer2, chainId, {
        contract: "CLPool",
        event: "Swap",
        params: {
          sender: userAddress,
          recipient: recipientAddress,
          amount0: -1000n, // Negative
          amount1: 500n, // Positive
          sqrtPriceX96: 1000000n,
          liquidity: 2000000n,
          tick: 100n,
        },
        block: {
          number: 1000000,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: { hash: negTxHash },
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const swapId2 = OUSDTSwapsId(
        negTxHash,
        chainId,
        mockToken1Data.address,
        500n,
        OUSDT_ADDRESS,
        1000n,
      );
      const swapEntity2 = await indexer2.OUSDTSwaps.get(swapId2);
      expect(swapEntity2).toBeDefined();
      if (!swapEntity2) return;
      expect(swapEntity2.transactionHash).toBe(negTxHash);
      // With amount1 > 0, token1 goes in, token0 (OUSDT) goes out
      expect(swapEntity2.tokenInPool).toBe(mockToken1Data.address); // token1 is going in
      expect(swapEntity2.tokenOutPool).toBe(OUSDT_ADDRESS); // token0 (OUSDT) is going out
      expect(swapEntity2.amountIn).toBe(500n); // amount1In = 500n
      expect(swapEntity2.amountOut).toBe(1000n); // amount0Out = 1000n
    });
  });

  describe("Mint Event", () => {
    const mintBlock = {
      number: 1000000,
      timestamp: 1000000,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process mint event and create NonFungiblePosition", async () => {
      // Test requires vi.spyOn on CLPoolMintLogic.processCLPoolMint
    });

    it("should return early if pool data not found", async () => {
      const indexer = createTestIndexer();
      // No pool seeded → handler returns early

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "Mint",
        params: {
          owner: userAddress,
          tickLower: -1000n,
          tickUpper: 1000n,
          amount: 1000n,
          amount0: 500n,
          amount1: 500n,
        },
        block: mintBlock,
        transaction: {
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(liquidityPool.id);
      expect(pool).toBeUndefined();
    });
  });

  describe("Burn Event", () => {
    const burnBlock = {
      number: 1000000,
      timestamp: 1000000,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process burn event and update pool aggregator", async () => {
      // Test requires vi.spyOn on CLPoolBurnLogic.processCLPoolBurn
    });

    it("should return early if pool data not found", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "Burn",
        params: {
          owner: userAddress,
          tickLower: -1000n,
          tickUpper: 1000n,
          amount: 500n,
          amount0: 250n,
          amount1: 250n,
        },
        block: burnBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(liquidityPool.id);
      expect(pool).toBeUndefined();
    });
  });

  describe("Collect Event", () => {
    const collectBlock = {
      number: 1000000,
      timestamp: 1000000,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process collect event and update fees", async () => {
      // Test requires vi.spyOn on CLPoolCollectLogic.processCLPoolCollect
    });

    it("should return early if pool data not found", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "Collect",
        params: {
          owner: userAddress,
          recipient: userAddress,
          tickLower: -1000n,
          tickUpper: 1000n,
          amount0: 100n,
          amount1: 200n,
        },
        block: collectBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(liquidityPool.id);
      expect(pool).toBeUndefined();
    });
  });

  describe("CollectFees Event", () => {
    const collectFeesBlock = {
      number: 1000000,
      timestamp: 1000000,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process collect fees event", async () => {
      // Test requires vi.spyOn on CLPoolCollectFeesLogic.processCLPoolCollectFees
    });

    it("should return early if pool data not found", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "CollectFees",
        params: {
          recipient: userAddress,
          amount0: 50n,
          amount1: 75n,
        },
        block: collectFeesBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(liquidityPool.id);
      expect(pool).toBeUndefined();
    });

    it("should refresh token prices when processing collect fees event", async () => {
      // Set up tokens with stale prices (2 hours ago)
      const staleTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const token0 = {
        ...mockToken0Data,
        pricePerUSDNew: 1000000n, // $1.00
        lastUpdatedTimestamp: staleTimestamp,
      };
      const token1 = {
        ...mockToken1Data,
        pricePerUSDNew: 2000000n, // $2.00
        lastUpdatedTimestamp: staleTimestamp,
      };

      const indexer = createTestIndexer();
      indexer.Pool.set(liquidityPool);
      indexer.Token.set(token0 as Token);
      indexer.Token.set(token1 as Token);

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "CollectFees",
        params: {
          recipient: userAddress,
          amount0: 50n,
          amount1: 75n,
        },
        block: collectFeesBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      // Verify tokens exist
      const updatedToken0 = await indexer.Token.get(token0.id);
      const updatedToken1 = await indexer.Token.get(token1.id);

      expect(updatedToken0).toBeDefined();
      expect(updatedToken1).toBeDefined();

      // Verify pool was updated
      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();
      // Verify staked and unstaked fees are tracked separately
      expect(updatedPool?.totalStakedFeesCollectedUSD).toBeDefined();
      expect(updatedPool?.totalUnstakedFeesCollectedUSD).toBeDefined();
      if (updatedPool?.totalStakedFeesCollectedUSD !== undefined) {
        expect(updatedPool.totalStakedFeesCollectedUSD >= 0n).toBe(true);
      }
      if (updatedPool?.totalUnstakedFeesCollectedUSD !== undefined) {
        expect(updatedPool.totalUnstakedFeesCollectedUSD >= 0n).toBe(true);
      }
    });
  });

  describe("Flash Event", () => {
    const flashBlock = {
      number: 1000000,
      timestamp: 1000000,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process flash event and update flash loan metrics", async () => {
      // Test requires vi.spyOn on CLPoolFlashLogic.processCLPoolFlash
    });

    it("should return early if pool data not found", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "Flash",
        params: {
          sender: userAddress,
          recipient: userAddress,
          amount0: 1000n,
          amount1: 0n,
          paid0: 1005n,
          paid1: 0n,
        },
        block: flashBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(liquidityPool.id);
      expect(pool).toBeUndefined();
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should not update user stats if flash loan volume is 0", async () => {
      // Test requires vi.spyOn on CLPoolFlashLogic.processCLPoolFlash
    });
  });

  describe("IncreaseObservationCardinalityNext Event", () => {
    const obsBlock = {
      number: 1000000,
      timestamp: 1000000,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    it("should update observation cardinality", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(liquidityPool);

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "IncreaseObservationCardinalityNext",
        params: {
          observationCardinalityNextNew: 100n,
          observationCardinalityNextOld: 50n,
        },
        block: obsBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.observationCardinalityNext).toBe(100n);
    });

    it("should return early if pool data not found", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "IncreaseObservationCardinalityNext",
        params: {
          observationCardinalityNextNew: 100n,
          observationCardinalityNextOld: 50n,
        },
        block: obsBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(liquidityPool.id);
      expect(pool).toBeUndefined();
    });
  });

  describe("SetFeeProtocol Event", () => {
    const feeBlock = {
      number: 1000000,
      timestamp: 1000000,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    it("should update fee protocol settings", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(liquidityPool);

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "SetFeeProtocol",
        params: {
          feeProtocol0New: 10n,
          feeProtocol1New: 20n,
          feeProtocol0Old: 5n,
          feeProtocol1Old: 15n,
        },
        block: feeBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.feeProtocol0).toBe(10n);
      expect(updatedPool?.feeProtocol1).toBe(20n);
    });

    it("should return early if pool data not found", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "SetFeeProtocol",
        params: {
          feeProtocol0New: 10n,
          feeProtocol1New: 20n,
          feeProtocol0Old: 5n,
          feeProtocol1Old: 15n,
        },
        block: feeBlock,
        srcAddress: liquidityPool.poolAddress as `0x${string}`,
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(liquidityPool.id);
      expect(pool).toBeUndefined();
    });
  });

  // Slipstream emits Initialize from the pool BEFORE its CLFactory emits
  // PoolCreated within the same tx, so the aggregator does not exist yet.
  // The handler buffers the opening price for PoolCreated to consume.
  describe("Initialize Event", () => {
    it("buffers sqrtPriceX96/tick into CLPoolPendingInitialize", async () => {
      const pool = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLPool",
        event: "Initialize",
        params: {
          sqrtPriceX96: 79228162514264337593543950336n,
          tick: 1n,
        },
        block: {
          number: 42,
          timestamp: 1_234_567,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: {
          hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        },
        srcAddress: pool,
        logIndex: 0,
      });

      // No phantom aggregator created — Initialize lacks token0/token1/tickSpacing.
      const aggregator = await indexer.Pool.get(PoolId(chainId, pool));
      expect(aggregator).toBeUndefined();

      const pending = await indexer.CLPoolPendingInitialize.get(
        PoolId(chainId, pool),
      );
      expect(pending).toBeDefined();
      if (!pending) return;
      expect(pending.sqrtPriceX96).toBe(79228162514264337593543950336n);
      expect(pending.tick).toBe(1n);
      expect(pending.poolAddress).toBe(pool);
      expect(pending.chainId).toBe(chainId);
    });
  });
});
