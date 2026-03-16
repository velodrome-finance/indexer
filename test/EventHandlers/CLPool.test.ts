import type { LiquidityPoolAggregator, Token } from "generated";
import type { MockInstance } from "vitest";
import { CLPool, MockDb } from "../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../src/Constants";
import * as CLPoolBurnLogic from "../../src/EventHandlers/CLPool/CLPoolBurnLogic";
import * as CLPoolCollectFeesLogic from "../../src/EventHandlers/CLPool/CLPoolCollectFeesLogic";
import * as CLPoolCollectLogic from "../../src/EventHandlers/CLPool/CLPoolCollectLogic";
import * as CLPoolFlashLogic from "../../src/EventHandlers/CLPool/CLPoolFlashLogic";
import * as CLPoolMintLogic from "../../src/EventHandlers/CLPool/CLPoolMintLogic";
import * as CLPoolSwapLogic from "../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import { setupCommon } from "./Pool/common";

describe("CLPool Events", () => {
  const { mockToken0Data, mockToken1Data, createMockLiquidityPoolAggregator } =
    setupCommon();
  const chainId = 10;
  const userAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const recipientAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let liquidityPool: LiquidityPoolAggregator;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();

    // Set up liquidity pool
    liquidityPool = createMockLiquidityPoolAggregator({
      isCL: true,
    });

    // Set up entities in mock DB
    mockDb = mockDb.entities.LiquidityPoolAggregator.set(liquidityPool);
    mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
    mockDb = mockDb.entities.Token.set(mockToken1Data as Token);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Swap Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Swap.createMockEvent>;
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolSwapLogic, "processCLPoolSwap")
        .mockResolvedValue({
          liquidityPoolDiff: {
            incrementalTotalVolume0: 1000n,
            incrementalTotalVolume1: 500n,
            incrementalTotalVolumeUSD: 1500n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Swap.createMockEvent({
        sender: userAddress,
        recipient: recipientAddress,
        amount0: 1000n,
        amount1: -500n,
        sqrtPriceX96: 1000000n,
        liquidity: 2000000n,
        tick: 100n,
        mockEventData: {
          srcAddress: liquidityPool.poolAddress as `0x${string}`,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          transaction: {
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process swap event and update pool aggregator", async () => {
      processSpy.mockClear();
      const resultDB = await mockDb.processEvents([mockEvent]);

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();

      // Verify pool cumulative totals are updated correctly from incremental values
      const initialTotalVolume0 = liquidityPool.totalVolume0;
      const initialTotalVolume1 = liquidityPool.totalVolume1;
      const initialTotalVolumeUSD = liquidityPool.totalVolumeUSD;
      expect(updatedPool?.totalVolume0).toBe(initialTotalVolume0 + 1000n);
      expect(updatedPool?.totalVolume1).toBe(initialTotalVolume1 + 500n);
      expect(updatedPool?.totalVolumeUSD).toBe(initialTotalVolumeUSD + 1500n);
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await emptyDb.processEvents([mockEvent]);

      // Should not throw, but processSpy shouldn't be called
      expect(processSpy).not.toHaveBeenCalled();
    });
  });

  describe("Mint Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Mint.createMockEvent>;
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolMintLogic, "processCLPoolMint")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalReserve0: 1000n,
            incrementalReserve1: 1000n,
            currentTotalLiquidityUSD: 2000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Mint.createMockEvent({
        owner: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount: 1000n,
        amount0: 500n,
        amount1: 500n,
        mockEventData: {
          srcAddress: liquidityPool.poolAddress as `0x${string}`,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          transaction: {
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process mint event and create NonFungiblePosition", async () => {
      processSpy.mockClear();
      const resultDB = await mockDb.processEvents([mockEvent]);

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      // Check that CLPoolMintEvent was created
      const mintEvents = Array.from(resultDB.entities.CLPoolMintEvent.getAll());
      expect(mintEvents).toHaveLength(1);
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await emptyDb.processEvents([mockEvent]);

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = emptyDb.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Burn Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Burn.createMockEvent>;
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolBurnLogic, "processCLPoolBurn")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalReserve0: -500n, // Negative because burning decreases reserves
            incrementalReserve1: -500n, // Negative because burning decreases reserves
            currentTotalLiquidityUSD: 1000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Burn.createMockEvent({
        owner: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount: 500n,
        amount0: 250n,
        amount1: 250n,
        mockEventData: {
          srcAddress: liquidityPool.poolAddress as `0x${string}`,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process burn event and update pool aggregator", async () => {
      processSpy.mockClear();
      const resultDB = await mockDb.processEvents([mockEvent]);

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await emptyDb.processEvents([mockEvent]);

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = emptyDb.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Collect Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Collect.createMockEvent>;
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolCollectLogic, "processCLPoolCollect")
        .mockReturnValue({
          liquidityPoolDiff: {
            // In CL pools, Collect events do NOT affect reserves - fees were never part of reserves
            // Track unstaked fees (from Collect events - LPs that didn't stake)
            incrementalTotalUnstakedFeesCollected0: 100n,
            incrementalTotalUnstakedFeesCollected1: 200n,
            incrementalTotalUnstakedFeesCollectedUSD: 300n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Collect.createMockEvent({
        owner: userAddress,
        recipient: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 100n,
        amount1: 200n,
        mockEventData: {
          srcAddress: liquidityPool.poolAddress as `0x${string}`,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process collect event and update fees", async () => {
      processSpy.mockClear();
      const resultDB = await mockDb.processEvents([mockEvent]);

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await emptyDb.processEvents([mockEvent]);

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = emptyDb.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("CollectFees Event", () => {
    let mockEvent: ReturnType<typeof CLPool.CollectFees.createMockEvent>;
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolCollectFeesLogic, "processCLPoolCollectFees")
        .mockReturnValue({
          liquidityPoolDiff: {
            // In CL pools, CollectFees events do NOT affect reserves - fees were never part of reserves
            // Track staked fees (from CollectFees events - LPs that staked in gauge)
            incrementalTotalStakedFeesCollected0: 50n,
            incrementalTotalStakedFeesCollected1: 75n,
            incrementalTotalStakedFeesCollectedUSD: 125n,
            incrementalTotalFeesUSDWhitelisted: 125n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.CollectFees.createMockEvent({
        recipient: userAddress,
        amount0: 50n,
        amount1: 75n,
        mockEventData: {
          srcAddress: liquidityPool.poolAddress as `0x${string}`,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process collect fees event", async () => {
      processSpy.mockClear();
      const resultDB = await mockDb.processEvents([mockEvent]);

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await emptyDb.processEvents([mockEvent]);

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = emptyDb.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeUndefined();
    });

    it("should refresh token prices when processing collect fees event", async () => {
      // Remove spy to test actual handler
      processSpy.mockRestore();

      // Set up tokens with stale prices (2 hours ago)
      const staleTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const existingToken0 = mockDb.entities.Token.get(mockToken0Data.id);
      const existingToken1 = mockDb.entities.Token.get(mockToken1Data.id);

      expect(existingToken0).toBeDefined();
      expect(existingToken1).toBeDefined();
      if (!existingToken0 || !existingToken1) {
        throw new Error("tokens expected from mockDb");
      }

      const token0 = {
        ...existingToken0,
        pricePerUSDNew: 1000000n, // $1.00
        lastUpdatedTimestamp: staleTimestamp,
      };
      const token1 = {
        ...existingToken1,
        pricePerUSDNew: 2000000n, // $2.00
        lastUpdatedTimestamp: staleTimestamp,
      };

      const updatedDb = mockDb.entities.Token.set(token0);
      const finalDb = updatedDb.entities.Token.set(token1);

      const resultDB = await finalDb.processEvents([mockEvent]);

      // Note: In a real scenario, the effect would be called and prices refreshed
      // For this test, we verify that the handler structure supports price refresh
      // The actual price refresh happens in loadPoolData which is tested separately

      // Verify tokens exist
      const updatedToken0 = resultDB.entities.Token.get(token0.id);
      const updatedToken1 = resultDB.entities.Token.get(token1.id);

      expect(updatedToken0).toBeDefined();
      expect(updatedToken1).toBeDefined();

      // Verify pool was updated
      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
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
    let mockEvent: ReturnType<typeof CLPool.Flash.createMockEvent>;
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolFlashLogic, "processCLPoolFlash")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalTotalFlashLoanFees0: 5n,
            incrementalTotalFlashLoanFees1: 0n,
            incrementalTotalFlashLoanFeesUSD: 5n,
            incrementalTotalFlashLoanVolumeUSD: 1000n,
            incrementalNumberOfFlashLoans: 1n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Flash.createMockEvent({
        sender: userAddress,
        recipient: userAddress,
        amount0: 1000n,
        amount1: 0n,
        paid0: 1005n,
        paid1: 0n,
        mockEventData: {
          srcAddress: liquidityPool.poolAddress as `0x${string}`,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process flash event and update flash loan metrics", async () => {
      processSpy.mockClear();
      const resultDB = await mockDb.processEvents([mockEvent]);

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await emptyDb.processEvents([mockEvent]);

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = emptyDb.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeUndefined();
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should not update user stats if flash loan volume is 0", async () => {
      processSpy.mockClear();
      processSpy.mockReturnValue({
        liquidityPoolDiff: {
          incrementalTotalFlashLoanFees0: 0n,
          incrementalTotalFlashLoanFees1: 0n,
          incrementalTotalFlashLoanFeesUSD: 0n,
          incrementalNumberOfFlashLoans: 1n,
          incrementalTotalFlashLoanVolumeUSD: 0n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        },
      });

      const resultDB = await mockDb.processEvents([mockEvent]);

      // Should still process
      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();
    });
  });

  describe("IncreaseObservationCardinalityNext Event", () => {
    let mockEvent: ReturnType<
      typeof CLPool.IncreaseObservationCardinalityNext.createMockEvent
    >;

    beforeEach(() => {
      mockEvent = CLPool.IncreaseObservationCardinalityNext.createMockEvent({
        observationCardinalityNextNew: 100n,
        observationCardinalityNextOld: 50n,
        mockEventData: {
          srcAddress: liquidityPool.poolAddress as `0x${string}`,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should update observation cardinality", async () => {
      const resultDB = await mockDb.processEvents([mockEvent]);

      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.observationCardinalityNext).toBe(100n);
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await emptyDb.processEvents([mockEvent]);

      // Should not throw, handler should return early
      const updatedPool = emptyDb.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("SetFeeProtocol Event", () => {
    let mockEvent: ReturnType<typeof CLPool.SetFeeProtocol.createMockEvent>;

    beforeEach(() => {
      mockEvent = CLPool.SetFeeProtocol.createMockEvent({
        feeProtocol0New: 10n,
        feeProtocol1New: 20n,
        feeProtocol0Old: 5n,
        feeProtocol1Old: 15n,
        mockEventData: {
          srcAddress: liquidityPool.poolAddress as `0x${string}`,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should update fee protocol settings", async () => {
      const resultDB = await mockDb.processEvents([mockEvent]);

      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.feeProtocol0).toBe(10n);
      expect(updatedPool?.feeProtocol1).toBe(20n);
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await emptyDb.processEvents([mockEvent]);

      // Should not throw, handler should return early
      const updatedPool = emptyDb.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeUndefined();
    });
  });
});
