import { TickMath } from "@uniswap/v3-sdk";
import type { CLPool_Initialize_event } from "generated";
import { CLPool, MockDb } from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { processCLPoolInitialize } from "../../../src/EventHandlers/CLPool/CLPoolInitializeLogic";
import "../../eventHandlersRegistration";
import { setupCommon } from "../Pool/common";

describe("CLPoolInitializeLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const chainId = 10;
  const sqrtPriceX96AtTick0 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());

  describe("processCLPoolInitialize", () => {
    it("writes sqrtPriceX96, tick, and lastUpdatedTimestamp to the diff", () => {
      const mockEvent = {
        chainId,
        block: { number: 12345, timestamp: 1_000_000 },
        logIndex: 1,
        srcAddress: poolAddress,
        transaction: { hash: "0x0" },
        params: {
          sqrtPriceX96: sqrtPriceX96AtTick0,
          tick: 42n,
        },
      } as unknown as CLPool_Initialize_event;

      const { liquidityPoolDiff } = processCLPoolInitialize(mockEvent);

      expect(liquidityPoolDiff.sqrtPriceX96).toBe(sqrtPriceX96AtTick0);
      expect(liquidityPoolDiff.tick).toBe(42n);
      expect(liquidityPoolDiff.lastUpdatedTimestamp).toEqual(
        new Date(1_000_000 * 1000),
      );
    });

    it("preserves negative ticks (int24 below zero)", () => {
      const mockEvent = {
        chainId,
        block: { number: 1, timestamp: 1 },
        logIndex: 0,
        srcAddress: poolAddress,
        transaction: { hash: "0x0" },
        params: {
          sqrtPriceX96: 1n,
          tick: -200_000n,
        },
      } as unknown as CLPool_Initialize_event;

      const { liquidityPoolDiff } = processCLPoolInitialize(mockEvent);

      expect(liquidityPoolDiff.tick).toBe(-200_000n);
    });
  });

  describe("CLPool.Initialize handler", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(() => {
      // Pool starts uninitialized — sqrtPriceX96/tick are 0n until Initialize
      // fires, matching the pre-first-swap dead-zone that #654 closes.
      mockDb = MockDb.createMockDb();
      const poolPreInit = {
        ...mockLiquidityPoolData,
        isCL: true,
        sqrtPriceX96: 0n,
        tick: 0n,
      };
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(poolPreInit)
        .entities.Token.set(mockToken0Data)
        .entities.Token.set(mockToken1Data);
    });

    it("populates sqrtPriceX96 and tick on the aggregator before any swap", async () => {
      const mockEvent = CLPool.Initialize.createMockEvent({
        sqrtPriceX96: sqrtPriceX96AtTick0,
        tick: 17n,
        mockEventData: {
          block: {
            timestamp: 1_234_567,
            number: 42,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId,
          logIndex: 0,
          srcAddress: poolAddress as `0x${string}`,
          transaction: {
            hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          },
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );
      expect(updatedPool).toBeDefined();
      if (!updatedPool) return;
      expect(updatedPool.sqrtPriceX96).toBe(sqrtPriceX96AtTick0);
      expect(updatedPool.tick).toBe(17n);
    });

    it("no-ops when the pool aggregator is missing (defensive)", async () => {
      const unknownPool = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      const mockEvent = CLPool.Initialize.createMockEvent({
        sqrtPriceX96: sqrtPriceX96AtTick0,
        tick: 1n,
        mockEventData: {
          block: {
            timestamp: 1_234_567,
            number: 42,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId,
          logIndex: 0,
          srcAddress: unknownPool as `0x${string}`,
          transaction: {
            hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          },
        },
      });

      // Should not throw or create a phantom aggregator for the unknown pool.
      const result = await mockDb.processEvents([mockEvent]);
      expect(
        result.entities.LiquidityPoolAggregator.get(
          `${chainId}-${unknownPool}`,
        ),
      ).toBeUndefined();
    });
  });
});
