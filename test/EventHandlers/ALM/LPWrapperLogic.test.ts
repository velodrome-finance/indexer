import type { ALM_LP_Wrapper, handlerContext } from "generated";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import * as TokenEffects from "../../../src/Effects/Token";
import {
  calculateLiquidityFromAmounts,
  deriveUserAmounts,
  loadALMLPWrapper,
  processDepositEvent,
  processTransferEvent,
  processWithdrawEvent,
} from "../../../src/EventHandlers/ALM/LPWrapperLogic";
import { setupCommon } from "../Pool/common";

describe("LPWrapperLogic", () => {
  const { mockALMLPWrapperData } = setupCommon();
  const chainId = 10;
  const poolAddress = "0x3333333333333333333333333333333333333333";
  const blockNumber = 123456;
  const roundedBlockNumber = 123000; // Example rounded block

  // Mock sqrtPriceX96 value (Q64.96 format)
  const mockSqrtPriceX96 = 79228162514264337593543950336n; // sqrt(1) * 2^96

  let mockContext: handlerContext;
  let mockGetSqrtPriceX96: jest.Mock;
  let roundBlockToIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on roundBlockToInterval
    roundBlockToIntervalSpy = jest
      .spyOn(TokenEffects, "roundBlockToInterval")
      .mockReturnValue(roundedBlockNumber);

    // Create mock context with effect mock
    mockGetSqrtPriceX96 = jest.fn();
    mockContext = {
      effect: mockGetSqrtPriceX96,
      log: {
        warn: jest.fn(),
        error: jest.fn(),
      },
    } as unknown as handlerContext;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("deriveUserAmounts", () => {
    it("should calculate user amounts from LP share", () => {
      const userLp = 1000n * 10n ** 18n;
      const totalLp = 5000n * 10n ** 18n;
      const wrapperAmount0 = 1000n * 10n ** 18n;
      const wrapperAmount1 = 500n * 10n ** 6n;

      const result = deriveUserAmounts(
        userLp,
        totalLp,
        wrapperAmount0,
        wrapperAmount1,
      );

      // User has 1000/5000 = 20% of LP, so gets 20% of amounts
      expect(result.amount0).toBe(200n * 10n ** 18n); // 1000 * 1000 / 5000 = 200
      expect(result.amount1).toBe(100n * 10n ** 6n); // 500 * 1000 / 5000 = 100
    });

    it("should return zero amounts when user LP is zero", () => {
      const result = deriveUserAmounts(
        0n,
        5000n * 10n ** 18n,
        1000n * 10n ** 18n,
        500n * 10n ** 6n,
      );

      expect(result.amount0).toBe(0n);
      expect(result.amount1).toBe(0n);
    });

    it("should return zero amounts when total LP is zero", () => {
      const result = deriveUserAmounts(
        1000n * 10n ** 18n,
        0n,
        1000n * 10n ** 18n,
        500n * 10n ** 6n,
      );

      expect(result.amount0).toBe(0n);
      expect(result.amount1).toBe(0n);
    });

    it("should handle fractional results correctly", () => {
      const userLp = 1n;
      const totalLp = 3n;
      const wrapperAmount0 = 10n;
      const wrapperAmount1 = 10n;

      const result = deriveUserAmounts(
        userLp,
        totalLp,
        wrapperAmount0,
        wrapperAmount1,
      );

      // 10 * 1 / 3 = 3 (integer division)
      expect(result.amount0).toBe(3n);
      expect(result.amount1).toBe(3n);
    });

    it("should handle user with partial LP share correctly", () => {
      // Realistic scenario: user has 30% of total LP
      const userLp = 300n * 10n ** 18n;
      const totalLp = 1000n * 10n ** 18n;
      const wrapperAmount0 = 1000n * 10n ** 18n;
      const wrapperAmount1 = 500n * 10n ** 6n;

      const result = deriveUserAmounts(
        userLp,
        totalLp,
        wrapperAmount0,
        wrapperAmount1,
      );

      // User has 30% share, so gets 30% of amounts
      // amount0: (1000 * 300) / 1000 = 300
      // amount1: (500 * 300) / 1000 = 150
      expect(result.amount0).toBe(300n * 10n ** 18n);
      expect(result.amount1).toBe(150n * 10n ** 6n);
    });
  });

  describe("calculateLiquidityFromAmounts", () => {
    it("should successfully calculate liquidity from amounts and price", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Mock successful sqrtPriceX96 fetch
      mockGetSqrtPriceX96.mockResolvedValue(mockSqrtPriceX96);

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Result should be a calculated liquidity value (not the original)
      expect(result).not.toBe(wrapper.liquidity);
      expect(typeof result).toBe("bigint");
      expect(mockGetSqrtPriceX96.mock.calls.length).toBe(1);
      expect(roundBlockToIntervalSpy.mock.calls.length).toBe(1);
      expect(roundBlockToIntervalSpy).toHaveBeenCalledWith(
        blockNumber,
        chainId,
      );
    });

    it("should retry with actual block number if rounded block fails", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // First call (rounded block) fails, second call (actual block) succeeds
      mockGetSqrtPriceX96
        .mockRejectedValueOnce(
          new Error("Pool does not exist at rounded block"),
        )
        .mockResolvedValueOnce(mockSqrtPriceX96);

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Withdraw",
      );

      // Verify retry happened (both calls were made)
      expect(mockGetSqrtPriceX96.mock.calls.length).toBe(2);
      // Verify first call was with rounded block
      // args[0] is the effect function (getSqrtPriceX96), args[1] is the input object
      expect(mockGetSqrtPriceX96.mock.calls[0][1].blockNumber).toBe(
        roundedBlockNumber,
      );
      // Verify second call was with actual block
      expect(mockGetSqrtPriceX96.mock.calls[1][1].blockNumber).toBe(
        blockNumber,
      );
      // Verify warning was logged
      expect(
        (mockContext.log.warn as jest.Mock).mock.calls.length,
      ).toBeGreaterThan(0);
      // Result should be a calculated value (may or may not equal wrapper.liquidity depending on calculation)
      expect(typeof result).toBe("bigint");
    });

    it("should return current liquidity if both rounded and actual block fail", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Both calls fail
      mockGetSqrtPriceX96.mockRejectedValue(new Error("Failed to fetch"));

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current liquidity
      expect(result).toBe(wrapper.liquidity);
      expect(
        (mockContext.log.error as jest.Mock).mock.calls.length,
      ).toBeGreaterThan(0);
    });

    it("should return current liquidity if sqrtPriceX96 is undefined", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      mockGetSqrtPriceX96.mockResolvedValue(undefined);

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Withdraw",
      );

      // Should return current liquidity
      expect(result).toBe(wrapper.liquidity);
      expect((mockContext.log.warn as jest.Mock).mock.calls.length).toBe(1);
      expect((mockContext.log.warn as jest.Mock).mock.calls[0][0]).toContain(
        "sqrtPriceX96 is undefined or 0",
      );
    });

    it("should return current liquidity if sqrtPriceX96 is zero", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      mockGetSqrtPriceX96.mockResolvedValue(0n);

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current liquidity
      expect(result).toBe(wrapper.liquidity);
      expect((mockContext.log.warn as jest.Mock).mock.calls.length).toBe(1);
    });

    it("should handle unexpected errors gracefully", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Throw unexpected error
      roundBlockToIntervalSpy.mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current liquidity on error
      expect(result).toBe(wrapper.liquidity);
      expect((mockContext.log.error as jest.Mock).mock.calls.length).toBe(1);
      expect((mockContext.log.error as jest.Mock).mock.calls[0][0]).toContain(
        "Error calculating liquidity from amounts",
      );
    });

    it("should use correct event type in log messages", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      mockGetSqrtPriceX96.mockRejectedValue(new Error("Failed"));

      await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "CustomEvent",
      );

      expect((mockContext.log.error as jest.Mock).mock.calls[0][0]).toContain(
        "ALMLPWrapper.CustomEvent",
      );
    });
  });

  describe("loadALMLPWrapper", () => {
    let mockContext: handlerContext;
    const srcAddress = "0x000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const chainId = 10;

    beforeEach(() => {
      mockContext = {
        ALM_LP_Wrapper: {
          get: jest.fn(),
        },
        log: {
          error: jest.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should return wrapper entity when found", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const mockWrapper = {
        ...mockALMLPWrapperData,
        id: wrapperId,
      };

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValue(
        mockWrapper,
      );

      const result = await loadALMLPWrapper(srcAddress, chainId, mockContext);

      expect(result).toEqual(mockWrapper);
      expect(
        (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mock.calls.length,
      ).toBe(1);
      expect(
        (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mock.calls[0][0],
      ).toBe(wrapperId);
      expect((mockContext.log.error as jest.Mock).mock.calls.length).toBe(0);
    });

    it("should return null and log error when wrapper not found", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValue(
        undefined,
      );

      const result = await loadALMLPWrapper(srcAddress, chainId, mockContext);

      expect(result).toBeNull();
      expect(
        (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mock.calls.length,
      ).toBe(1);
      expect(
        (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mock.calls[0][0],
      ).toBe(wrapperId);
      expect((mockContext.log.error as jest.Mock).mock.calls.length).toBe(1);
      expect((mockContext.log.error as jest.Mock).mock.calls[0][0]).toContain(
        wrapperId,
      );
    });
  });

  describe("processDepositEvent", () => {
    let mockContext: handlerContext;
    const recipient = "0xcccccccccccccccccccccccccccccccccccccccc";
    const pool = "0x3333333333333333333333333333333333333333";
    const srcAddress = "0x000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const chainId = 10;
    const blockNumber = 123456;
    const timestamp = new Date(1000000 * 1000);
    const amount0 = 500n * TEN_TO_THE_18_BI;
    const amount1 = 250n * TEN_TO_THE_6_BI;
    const lpAmount = 1000n * TEN_TO_THE_18_BI;

    beforeEach(() => {
      mockGetSqrtPriceX96 = jest.fn().mockResolvedValue(mockSqrtPriceX96);

      mockContext = {
        ALM_LP_Wrapper: {
          get: jest.fn(),
          set: jest.fn(),
        },
        UserStatsPerPool: {
          get: jest.fn(),
          set: jest.fn(),
        },
        effect: mockGetSqrtPriceX96,
        log: {
          warn: jest.fn(),
          error: jest.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should process deposit event successfully", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const mockWrapper = {
        ...mockALMLPWrapperData,
        id: wrapperId,
        amount0: 1000n * TEN_TO_THE_18_BI,
        amount1: 500n * TEN_TO_THE_6_BI,
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const userStatsId = `${toChecksumAddress(recipient)}_${toChecksumAddress(pool)}_${chainId}`;
      const mockUserStats = {
        id: userStatsId,
        userAddress: toChecksumAddress(recipient),
        poolAddress: toChecksumAddress(pool),
        chainId: chainId,
        almLpAmount: 0n,
        almAmount0: 0n,
        almAmount1: 0n,
      };

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        mockWrapper,
      );
      // Pre-create user stats so loadOrCreateUserData doesn't call set
      // (loadOrCreateUserData calls set when creating a new entity)
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce(
        mockUserStats,
      );

      await processDepositEvent(
        recipient,
        pool,
        amount0,
        amount1,
        lpAmount,
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
      );

      // Verify wrapper was updated
      expect(
        (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock.calls.length,
      ).toBe(1);
      const wrapperUpdate = (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock
        .calls[0][0];
      expect(wrapperUpdate.amount0).toBe(mockWrapper.amount0 + amount0);
      expect(wrapperUpdate.amount1).toBe(mockWrapper.amount1 + amount1);
      // lpAmount is aggregated: diff.lpAmount + current.lpAmount
      // Deposit: lpAmount (1000) + current (2000) = 3000
      expect(wrapperUpdate.lpAmount).toBe(mockWrapper.lpAmount + lpAmount);
      expect(wrapperUpdate.ammStateIsDerived).toBe(true);

      // Verify user stats were updated
      expect(
        (mockContext.UserStatsPerPool?.set as jest.Mock).mock.calls.length,
      ).toBe(1);
    });

    it("should return early if wrapper not found", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const userStatsId = `${toChecksumAddress(recipient)}_${toChecksumAddress(pool)}_${chainId}`;

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        undefined,
      );
      // Pre-create user stats so loadOrCreateUserData doesn't call set
      // (loadOrCreateUserData is called in parallel and may call set before we return early)
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce({
        id: userStatsId,
        userAddress: toChecksumAddress(recipient),
        poolAddress: toChecksumAddress(pool),
        chainId: chainId,
        almLpAmount: 0n,
        almAmount0: 0n,
        almAmount1: 0n,
      });

      await processDepositEvent(
        recipient,
        pool,
        amount0,
        amount1,
        lpAmount,
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
      );

      // Should not update anything
      expect(
        (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock.calls.length,
      ).toBe(0);
      expect(
        (mockContext.UserStatsPerPool?.set as jest.Mock).mock.calls.length,
      ).toBe(0);
    });
  });

  describe("processWithdrawEvent", () => {
    let mockContext: handlerContext;
    const recipient = "0xcccccccccccccccccccccccccccccccccccccccc";
    const pool = "0x3333333333333333333333333333333333333333";
    const srcAddress = "0x000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const chainId = 10;
    const blockNumber = 123456;
    const timestamp = new Date(1000000 * 1000);
    const amount0 = 250n * TEN_TO_THE_18_BI;
    const amount1 = 125n * TEN_TO_THE_6_BI;
    const lpAmount = 500n * TEN_TO_THE_18_BI;

    beforeEach(() => {
      mockGetSqrtPriceX96 = jest.fn().mockResolvedValue(mockSqrtPriceX96);

      mockContext = {
        ALM_LP_Wrapper: {
          get: jest.fn(),
          set: jest.fn(),
        },
        UserStatsPerPool: {
          get: jest.fn(),
          set: jest.fn(),
        },
        effect: mockGetSqrtPriceX96,
        log: {
          warn: jest.fn(),
          error: jest.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should process withdraw event successfully", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const mockWrapper = {
        ...mockALMLPWrapperData,
        id: wrapperId,
        amount0: 1000n * TEN_TO_THE_18_BI,
        amount1: 500n * TEN_TO_THE_6_BI,
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const userStatsId = `${toChecksumAddress(recipient)}_${toChecksumAddress(pool)}_${chainId}`;
      const mockUserStats = {
        id: userStatsId,
        userAddress: toChecksumAddress(recipient),
        poolAddress: toChecksumAddress(pool),
        chainId: chainId,
        almLpAmount: 1000n * TEN_TO_THE_18_BI,
        almAmount0: 500n * TEN_TO_THE_18_BI,
        almAmount1: 250n * TEN_TO_THE_6_BI,
      };

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        mockWrapper,
      );
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce(
        mockUserStats,
      );

      await processWithdrawEvent(
        recipient,
        pool,
        amount0,
        amount1,
        lpAmount,
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
      );

      // Verify wrapper was updated
      expect(
        (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock.calls.length,
      ).toBe(1);
      const wrapperUpdate = (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock
        .calls[0][0];
      expect(wrapperUpdate.amount0).toBe(mockWrapper.amount0 - amount0);
      expect(wrapperUpdate.amount1).toBe(mockWrapper.amount1 - amount1);
      // lpAmount is aggregated: diff.lpAmount + current.lpAmount
      // Withdraw: -lpAmount (-500) + current (2000) = 1500
      expect(wrapperUpdate.lpAmount).toBe(mockWrapper.lpAmount - lpAmount);
      expect(wrapperUpdate.ammStateIsDerived).toBe(true);

      // Verify user stats were updated
      expect(
        (mockContext.UserStatsPerPool?.set as jest.Mock).mock.calls.length,
      ).toBe(1);
    });

    it("should return early if wrapper not found", async () => {
      const userStatsId = `${toChecksumAddress(recipient)}_${toChecksumAddress(pool)}_${chainId}`;

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        undefined,
      );
      // Pre-create user stats so loadOrCreateUserData doesn't call set
      // (loadOrCreateUserData is called in parallel and may call set before we return early)
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce({
        id: userStatsId,
        userAddress: toChecksumAddress(recipient),
        poolAddress: toChecksumAddress(pool),
        chainId: chainId,
        almLpAmount: 0n,
        almAmount0: 0n,
        almAmount1: 0n,
      });

      await processWithdrawEvent(
        recipient,
        pool,
        amount0,
        amount1,
        lpAmount,
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
      );

      // Should not update anything
      expect(
        (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock.calls.length,
      ).toBe(0);
      expect(
        (mockContext.UserStatsPerPool?.set as jest.Mock).mock.calls.length,
      ).toBe(0);
    });
  });

  describe("processTransferEvent", () => {
    let mockContext: handlerContext;
    const from = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const to = "0xffffffffffffffffffffffffffffffffffffffff";
    const value = 500n * TEN_TO_THE_18_BI;
    const srcAddress = "0x000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const chainId = 10;
    const timestamp = new Date(1000000 * 1000);
    const pool = "0x3333333333333333333333333333333333333333";

    beforeEach(() => {
      mockContext = {
        ALM_LP_Wrapper: {
          get: jest.fn(),
        },
        UserStatsPerPool: {
          get: jest.fn(),
          set: jest.fn(),
        },
        log: {
          error: jest.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should process transfer event successfully", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const mockWrapper = {
        ...mockALMLPWrapperData,
        id: wrapperId,
        pool: toChecksumAddress(pool),
        amount0: 1000n * TEN_TO_THE_18_BI,
        amount1: 500n * TEN_TO_THE_6_BI,
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const fromUserStatsId = `${toChecksumAddress(from)}_${toChecksumAddress(pool)}_${chainId}`;
      const toUserStatsId = `${toChecksumAddress(to)}_${toChecksumAddress(pool)}_${chainId}`;

      const mockFromUserStats = {
        id: fromUserStatsId,
        userAddress: toChecksumAddress(from),
        poolAddress: toChecksumAddress(pool),
        chainId: chainId,
        almLpAmount: 1000n * TEN_TO_THE_18_BI,
        almAmount0: 500n * TEN_TO_THE_18_BI,
        almAmount1: 250n * TEN_TO_THE_6_BI,
      };

      const mockToUserStats = {
        id: toUserStatsId,
        userAddress: toChecksumAddress(to),
        poolAddress: toChecksumAddress(pool),
        chainId: chainId,
        almLpAmount: 0n,
        almAmount0: 0n,
        almAmount1: 0n,
      };

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        mockWrapper,
      );
      (mockContext.UserStatsPerPool?.get as jest.Mock)
        .mockResolvedValueOnce(mockFromUserStats)
        .mockResolvedValueOnce(mockToUserStats);

      await processTransferEvent(
        from,
        to,
        value,
        srcAddress,
        chainId,
        timestamp,
        mockContext,
      );

      // Verify both user stats were updated
      // loadOrCreateUserData doesn't call set since both entities exist
      // updateUserStatsPerPool is called twice (once for sender, once for recipient)
      expect(
        (mockContext.UserStatsPerPool?.set as jest.Mock).mock.calls.length,
      ).toBe(2);

      // Verify sender's stats were updated (decreased)
      const fromUpdate = (mockContext.UserStatsPerPool?.set as jest.Mock).mock
        .calls[0][0];
      expect(fromUpdate.almLpAmount).toBe(
        mockFromUserStats.almLpAmount - value,
      );

      // Verify recipient's stats were updated (increased)
      const toUpdate = (mockContext.UserStatsPerPool?.set as jest.Mock).mock
        .calls[1][0];
      expect(toUpdate.almLpAmount).toBe(value);
      expect(toUpdate.almAddress).toBe(srcAddress);
    });

    it("should skip zero address transfers (mint/burn)", async () => {
      // Mint: from zero address
      await processTransferEvent(
        ZERO_ADDRESS,
        to,
        value,
        srcAddress,
        chainId,
        timestamp,
        mockContext,
      );

      // Burn: to zero address
      await processTransferEvent(
        from,
        ZERO_ADDRESS,
        value,
        srcAddress,
        chainId,
        timestamp,
        mockContext,
      );

      // Should not load wrapper or update any stats
      expect(
        (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mock.calls.length,
      ).toBe(0);
      expect(
        (mockContext.UserStatsPerPool?.set as jest.Mock).mock.calls.length,
      ).toBe(0);
    });

    it("should return early if wrapper not found", async () => {
      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        undefined,
      );

      await processTransferEvent(
        from,
        to,
        value,
        srcAddress,
        chainId,
        timestamp,
        mockContext,
      );

      // Should not update any stats
      expect(
        (mockContext.UserStatsPerPool?.set as jest.Mock).mock.calls.length,
      ).toBe(0);
    });
  });
});
