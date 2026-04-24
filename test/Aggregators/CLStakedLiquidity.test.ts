import type { CLTickStaked, handlerContext } from "generated";
import {
  computeStakedSwapReserveDelta,
  isPositionInRange,
  processTickCrossingsForStaked,
  updateTicksForStakedPosition,
} from "../../src/Aggregators/CLStakedLiquidity";
import { CLTickStakedId } from "../../src/Constants";

describe("CLStakedLiquidity", () => {
  const CHAIN_ID = 8453;
  const POOL_ADDRESS = "0x1234567890123456789012345678901234567890";

  describe("isPositionInRange", () => {
    it("should return true when currentTick is within range", () => {
      expect(isPositionInRange(100n, 200n, 150n)).toBe(true);
    });

    it("should return true when currentTick equals tickLower (inclusive)", () => {
      expect(isPositionInRange(100n, 200n, 100n)).toBe(true);
    });

    it("should return false when currentTick equals tickUpper (exclusive)", () => {
      expect(isPositionInRange(100n, 200n, 200n)).toBe(false);
    });

    it("should return false when currentTick is below tickLower", () => {
      expect(isPositionInRange(100n, 200n, 50n)).toBe(false);
    });

    it("should return false when currentTick is above tickUpper", () => {
      expect(isPositionInRange(100n, 200n, 300n)).toBe(false);
    });

    it("should handle negative tick values", () => {
      expect(isPositionInRange(-200n, -100n, -150n)).toBe(true);
      expect(isPositionInRange(-200n, -100n, -200n)).toBe(true);
      expect(isPositionInRange(-200n, -100n, -100n)).toBe(false);
      expect(isPositionInRange(-200n, -100n, -250n)).toBe(false);
    });

    it("should handle range spanning zero", () => {
      expect(isPositionInRange(-100n, 100n, 0n)).toBe(true);
      expect(isPositionInRange(-100n, 100n, -100n)).toBe(true);
      expect(isPositionInRange(-100n, 100n, 100n)).toBe(false);
    });

    it("should handle single-tick range (tickLower = tickUpper - 1)", () => {
      expect(isPositionInRange(99n, 100n, 99n)).toBe(true);
      expect(isPositionInRange(99n, 100n, 100n)).toBe(false);
    });
  });

  describe("updateTicksForStakedPosition", () => {
    let tickStore: Map<string, CLTickStaked>;
    let mockContext: handlerContext;

    beforeEach(() => {
      tickStore = new Map();
      mockContext = {
        CLTickStaked: {
          get: vi
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(tickStore.get(id) ?? null),
            ),
          set: vi
            .fn()
            .mockImplementation((entity: CLTickStaked) =>
              tickStore.set(entity.id, entity),
            ),
        },
      } as unknown as handlerContext;
    });

    it("should create new tick entities on first stake", async () => {
      await updateTicksForStakedPosition(
        CHAIN_ID,
        POOL_ADDRESS,
        -200n,
        200n,
        1000n,
        mockContext,
      );

      const lowerId = CLTickStakedId(CHAIN_ID, POOL_ADDRESS, -200n);
      const upperId = CLTickStakedId(CHAIN_ID, POOL_ADDRESS, 200n);

      expect(tickStore.get(lowerId)?.stakedLiquidityNet).toBe(1000n);
      expect(tickStore.get(upperId)?.stakedLiquidityNet).toBe(-1000n);
    });

    it("should accumulate liquidity from multiple positions at same ticks", async () => {
      // First position: +500 at lower, -500 at upper
      await updateTicksForStakedPosition(
        CHAIN_ID,
        POOL_ADDRESS,
        0n,
        400n,
        500n,
        mockContext,
      );
      // Second position: +300 at same ticks
      await updateTicksForStakedPosition(
        CHAIN_ID,
        POOL_ADDRESS,
        0n,
        400n,
        300n,
        mockContext,
      );

      const lowerId = CLTickStakedId(CHAIN_ID, POOL_ADDRESS, 0n);
      const upperId = CLTickStakedId(CHAIN_ID, POOL_ADDRESS, 400n);

      expect(tickStore.get(lowerId)?.stakedLiquidityNet).toBe(800n);
      expect(tickStore.get(upperId)?.stakedLiquidityNet).toBe(-800n);
    });

    it("should handle unstake (negative liquidityDelta)", async () => {
      // Stake 1000
      await updateTicksForStakedPosition(
        CHAIN_ID,
        POOL_ADDRESS,
        -100n,
        100n,
        1000n,
        mockContext,
      );
      // Unstake 1000
      await updateTicksForStakedPosition(
        CHAIN_ID,
        POOL_ADDRESS,
        -100n,
        100n,
        -1000n,
        mockContext,
      );

      const lowerId = CLTickStakedId(CHAIN_ID, POOL_ADDRESS, -100n);
      const upperId = CLTickStakedId(CHAIN_ID, POOL_ADDRESS, 100n);

      expect(tickStore.get(lowerId)?.stakedLiquidityNet).toBe(0n);
      expect(tickStore.get(upperId)?.stakedLiquidityNet).toBe(0n);
    });

    it("should store correct chainId, poolAddress, and tickIndex", async () => {
      await updateTicksForStakedPosition(
        CHAIN_ID,
        POOL_ADDRESS,
        -600n,
        600n,
        100n,
        mockContext,
      );

      const lowerId = CLTickStakedId(CHAIN_ID, POOL_ADDRESS, -600n);
      const lower = tickStore.get(lowerId);
      expect(lower?.chainId).toBe(CHAIN_ID);
      expect(lower?.poolAddress).toBe(POOL_ADDRESS);
      expect(lower?.tickIndex).toBe(-600n);
    });
  });

  describe("processTickCrossingsForStaked", () => {
    let tickStore: Map<string, CLTickStaked>;
    let mockContext: handlerContext;
    let logErrorSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      tickStore = new Map();
      logErrorSpy = vi.fn();
      mockContext = {
        CLTickStaked: {
          get: vi
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(tickStore.get(id) ?? null),
            ),
          set: vi
            .fn()
            .mockImplementation((entity: CLTickStaked) =>
              tickStore.set(entity.id, entity),
            ),
        },
        log: {
          error: logErrorSpy,
          warn: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
        },
      } as unknown as handlerContext;
    });

    /**
     * Helper to seed a CLTickStaked entity at a given tick index.
     */
    function seedTick(tickIndex: bigint, stakedLiquidityNet: bigint): void {
      const id = CLTickStakedId(CHAIN_ID, POOL_ADDRESS, tickIndex);
      tickStore.set(id, {
        id,
        chainId: CHAIN_ID,
        poolAddress: POOL_ADDRESS,
        tickIndex,
        stakedLiquidityNet,
      });
    }

    it("should return unchanged when oldTick === newTick", async () => {
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        100n,
        200n,
        mockContext,
        500n,
        true,
      );
      expect(result).toBe(500n);
    });

    it("should return unchanged when tickSpacing is zero", async () => {
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        300n,
        0n,
        mockContext,
        500n,
        true,
      );
      expect(result).toBe(500n);
    });

    it("should add stakedLiquidityNet when crossing up", async () => {
      // Position staked at [200, 400]: lower tick has +300
      seedTick(200n, 300n);

      // Swap from tick 100 to tick 250 (crosses tick 200 going up)
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        250n,
        200n,
        mockContext,
        0n,
        true,
      );

      // alignTickUp(100, 200) = 200, crosses 200 (200 <= 250)
      expect(result).toBe(300n);
    });

    it("should subtract stakedLiquidityNet when crossing down", async () => {
      // Position staked at [200, 400]: lower tick has +300
      seedTick(200n, 300n);

      // Swap from tick 250 to tick 100 (crosses tick 200 going down)
      // alignTickDown(250, 200) = 200, crosses 200 (200 > 100)
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        250n,
        100n,
        200n,
        mockContext,
        300n,
        true,
      );

      expect(result).toBe(0n);
    });

    it("should handle multiple tick crossings going up", async () => {
      seedTick(200n, 100n);
      seedTick(400n, 200n);
      seedTick(600n, -50n);

      // Swap from tick 100 to tick 650
      // alignTickUp(100, 200) = 200
      // Crosses: 200 (+100), 400 (+200), 600 (-50) — all <= 650
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        650n,
        200n,
        mockContext,
        0n,
        true,
      );

      expect(result).toBe(250n); // 0 + 100 + 200 - 50
    });

    it("should handle multiple tick crossings going down", async () => {
      seedTick(600n, -50n);
      seedTick(400n, 200n);
      seedTick(200n, 100n);

      // Swap from tick 650 to tick 100
      // alignTickDown(650, 200) = 600
      // Crosses: 600 (sub -50 → +50), 400 (sub 200 → -150), 200 (sub 100 → -250)
      // All > 100
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        650n,
        100n,
        200n,
        mockContext,
        250n,
        true,
      );

      // 250 - (-50) - 200 - 100 = 250 + 50 - 200 - 100 = 0
      expect(result).toBe(0n);
    });

    it("should skip ticks with no entity (treat as zero)", async () => {
      // Only seed tick 400, tick 200 has no entity
      seedTick(400n, 150n);

      // Swap from tick 100 to tick 450
      // alignTickUp(100, 200) = 200
      // Crosses: 200 (no entity → skip), 400 (+150) — both <= 450
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        450n,
        200n,
        mockContext,
        50n,
        true,
      );

      expect(result).toBe(200n); // 50 + 150
    });

    it("should handle negative tick ranges", async () => {
      seedTick(-200n, 500n);

      // Swap from tick -300 to tick -100 (crosses -200 going up)
      // alignTickUp(-300, 200) = -200 (strictly above -300)
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        -300n,
        -100n,
        200n,
        mockContext,
        0n,
        true,
      );

      expect(result).toBe(500n);
    });

    it("should not cross the oldTick itself when going up (alignTickUp is strictly above)", async () => {
      seedTick(200n, 100n);

      // oldTick = 200, newTick = 350
      // alignTickUp(200, 200) = 400 (strictly above 200)
      // 400 > 350, so NO ticks are crossed
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        200n,
        350n,
        200n,
        mockContext,
        0n,
        true,
      );

      expect(result).toBe(0n);
    });

    it("should include the oldTick boundary when going down (alignTickDown is at-or-below)", async () => {
      seedTick(200n, 100n);

      // oldTick = 200, newTick = 50
      // alignTickDown(200, 200) = 200
      // 200 > 50, so tick 200 IS crossed
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        200n,
        50n,
        200n,
        mockContext,
        100n,
        true,
      );

      // 100 - 100 = 0
      expect(result).toBe(0n);
    });

    it("should handle tickSpacing of 1", async () => {
      seedTick(101n, 10n);
      seedTick(102n, 20n);
      seedTick(103n, -5n);

      // Swap from tick 100 to tick 103, spacing=1
      // alignTickUp(100, 1) = 101
      // Crosses: 101 (+10), 102 (+20), 103 (-5) — all <= 103
      const result = await processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        103n,
        1n,
        mockContext,
        0n,
        true,
      );

      expect(result).toBe(25n); // 0 + 10 + 20 - 5
    });

    describe("safety guards", () => {
      it("should short-circuit when hasStakes is false (skip CLTickStaked reads)", async () => {
        // Seed a tick entity that would otherwise contribute — the guard must
        // skip the read so this value is never applied.
        seedTick(200n, 999n);

        const result = await processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          100n,
          250n,
          200n,
          mockContext,
          500n,
          false,
        );

        expect(result).toBe(500n);
        expect(mockContext.CLTickStaked.get).not.toHaveBeenCalled();
      });

      it("should bail and log when oldTick is below TICK_MIN", async () => {
        const result = await processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          -900000n, // below TICK_MIN = -887272n
          100n,
          200n,
          mockContext,
          500n,
          true,
        );

        expect(result).toBe(500n);
        expect(logErrorSpy).toHaveBeenCalledTimes(1);
        expect(logErrorSpy.mock.calls[0][0]).toContain(
          "out of Uniswap v3 range",
        );
        expect(mockContext.CLTickStaked.get).not.toHaveBeenCalled();
      });

      it("should bail and log when newTick is above TICK_MAX", async () => {
        const result = await processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          100n,
          900000n, // above TICK_MAX = 887272n
          200n,
          mockContext,
          500n,
          true,
        );

        expect(result).toBe(500n);
        expect(logErrorSpy).toHaveBeenCalledTimes(1);
        expect(mockContext.CLTickStaked.get).not.toHaveBeenCalled();
      });

      it("should accept boundary ticks at exactly TICK_MIN and TICK_MAX", async () => {
        // No tick entities seeded → result should equal the input
        const result = await processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          -887272n,
          887272n,
          200n,
          mockContext,
          0n,
          true,
        );

        expect(result).toBe(0n);
        expect(logErrorSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("computeStakedSwapReserveDelta", () => {
    it("should compute proportional split correctly", () => {
      const result = computeStakedSwapReserveDelta(
        -100n,
        500n,
        200n, // staked
        1000n, // total
      );

      // -100 * 200/1000 = -20, 500 * 200/1000 = 100
      expect(result.stakedDelta0).toBe(-20n);
      expect(result.stakedDelta1).toBe(100n);
    });

    it("should return zero when totalLiqInRange is zero", () => {
      const result = computeStakedSwapReserveDelta(-100n, 500n, 200n, 0n);

      expect(result.stakedDelta0).toBe(0n);
      expect(result.stakedDelta1).toBe(0n);
    });

    it("should return zero when stakedLiqInRange is zero", () => {
      const result = computeStakedSwapReserveDelta(-100n, 500n, 0n, 1000n);

      expect(result.stakedDelta0).toBe(0n);
      expect(result.stakedDelta1).toBe(0n);
    });

    it("should return full delta when stakedLiq equals totalLiq (100% staked)", () => {
      const result = computeStakedSwapReserveDelta(-100n, 500n, 1000n, 1000n);

      expect(result.stakedDelta0).toBe(-100n);
      expect(result.stakedDelta1).toBe(500n);
    });

    it("should handle rounding via bigint truncation", () => {
      // 100 * 1 / 3 = 33 (truncated from 33.33...)
      const result = computeStakedSwapReserveDelta(100n, -100n, 1n, 3n);

      expect(result.stakedDelta0).toBe(33n);
      expect(result.stakedDelta1).toBe(-33n);
    });

    it("should handle large values", () => {
      const large = 10n ** 30n;
      const result = computeStakedSwapReserveDelta(
        large,
        -large,
        large / 2n,
        large,
      );

      expect(result.stakedDelta0).toBe(large / 2n);
      expect(result.stakedDelta1).toBe(-(large / 2n));
    });
  });
});
