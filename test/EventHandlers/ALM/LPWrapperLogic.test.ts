import type { ALM_LP_Wrapper, handlerContext } from "generated";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  calculateLiquidityFromAmounts,
  deriveUserAmounts,
  getMatchingBurnTransferInTx,
  loadALMLPWrapper,
  processDepositEvent,
  processTransferEvent,
  processWithdrawEvent,
} from "../../../src/EventHandlers/ALM/LPWrapperLogic";
import { computeLiquidityDeltaFromAmounts } from "../../../src/Helpers";
import { setupCommon } from "../Pool/common";

describe("LPWrapperLogic", () => {
  const { mockALMLPWrapperData, mockLiquidityPoolData } = setupCommon();
  const poolId = mockLiquidityPoolData.id;
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const blockNumber = 123456;
  const timestamp = new Date(1000000 * 1000);
  const txHash = "0xtesttxhash";

  // Shared addresses
  const srcAddress = "0x000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sender = "0xcccccccccccccccccccccccccccccccccccccccc";
  const from = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const to = "0xffffffffffffffffffffffffffffffffffffffff";

  // Shared amounts
  const amount0 = 250n * TEN_TO_THE_18_BI;
  const amount1 = 125n * TEN_TO_THE_6_BI;
  const value = 500n * TEN_TO_THE_18_BI;
  const actualBurnedAmount = 500n * TEN_TO_THE_18_BI;
  const suspiciousLpAmount = 2n ** 256n - 1n; // Input parameter for V1 (not actual burned amount)

  // Shared log indices
  const withdrawLogIndex = 100;
  const transferLogIndex = 50;

  // Mock sqrtPriceX96 value (Q64.96 format)
  const mockSqrtPriceX96 = 79228162514264337593543950336n; // sqrt(1) * 2^96

  let mockContext: handlerContext;
  let mockLiquidityPoolAggregator: jest.Mock;

  beforeEach(() => {
    mockLiquidityPoolAggregator = jest.fn().mockResolvedValue({
      sqrtPriceX96: mockSqrtPriceX96,
      isCL: true,
    });

    mockContext = {
      LiquidityPoolAggregator: {
        get: mockLiquidityPoolAggregator,
      },
      log: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
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
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

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
      expect(mockLiquidityPoolAggregator).toHaveBeenCalledTimes(1);
      expect(mockLiquidityPoolAggregator).toHaveBeenCalledWith(poolId);
    });

    it("should return current liquidity if pool entity is not found", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Mock pool entity not found
      mockLiquidityPoolAggregator.mockResolvedValue(null);

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
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(1);
      expect(mockLiquidityPoolAggregator).toHaveBeenCalledTimes(1);
    });

    it("should return current liquidity if pool entity fetch throws error", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Mock pool entity fetch throws error
      mockLiquidityPoolAggregator.mockRejectedValue(
        new Error("Failed to fetch"),
      );

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
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(1);
    });

    it("should return current liquidity if sqrtPriceX96 is undefined", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Mock pool with undefined sqrtPriceX96
      mockLiquidityPoolAggregator.mockResolvedValue({
        sqrtPriceX96: undefined,
        isCL: true,
      });

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
      expect(mockContext.log.warn as jest.Mock).toHaveBeenCalledTimes(1);
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
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Mock pool with sqrtPriceX96 = 0
      mockLiquidityPoolAggregator.mockResolvedValue({
        sqrtPriceX96: 0n,
        isCL: true,
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

      // Should return current liquidity
      expect(result).toBe(wrapper.liquidity);
      expect(mockContext.log.warn as jest.Mock).toHaveBeenCalledTimes(1);
    });

    it("should handle unexpected errors gracefully", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Throw unexpected error when fetching pool entity
      mockLiquidityPoolAggregator.mockRejectedValue(
        new Error("Unexpected error"),
      );

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
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(1);
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
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Mock pool entity fetch to throw error
      mockLiquidityPoolAggregator.mockRejectedValue(new Error("Failed"));

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
        mockContext.ALM_LP_Wrapper?.get as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      expect(
        (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mock.calls[0][0],
      ).toBe(wrapperId);
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(0);
    });

    it("should return null and log error when wrapper not found", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValue(
        undefined,
      );

      const result = await loadALMLPWrapper(srcAddress, chainId, mockContext);

      expect(result).toBeNull();
      expect(
        mockContext.ALM_LP_Wrapper?.get as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      expect(
        (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mock.calls[0][0],
      ).toBe(wrapperId);
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(1);
      expect((mockContext.log.error as jest.Mock).mock.calls[0][0]).toContain(
        wrapperId,
      );
    });
  });

  describe("processDepositEvent", () => {
    let mockContext: handlerContext;
    const recipient = "0xcccccccccccccccccccccccccccccccccccccccc";
    const depositAmount0 = 500n * TEN_TO_THE_18_BI;
    const depositAmount1 = 250n * TEN_TO_THE_6_BI;
    const depositLpAmount = 1000n * TEN_TO_THE_18_BI;

    beforeEach(() => {
      const mockPool = {
        sqrtPriceX96: mockSqrtPriceX96,
        isCL: true,
      };

      mockContext = {
        ALM_LP_Wrapper: {
          get: jest.fn(),
          set: jest.fn(),
        },
        UserStatsPerPool: {
          get: jest.fn(),
          set: jest.fn(),
        },
        LiquidityPoolAggregator: {
          get: jest.fn((poolAddr) => {
            if (poolAddr === poolId) {
              return Promise.resolve(mockPool);
            }
            return Promise.resolve(null);
          }),
        },
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
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const userStatsId = `${toChecksumAddress(recipient)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const mockUserStats = {
        id: userStatsId,
        userAddress: toChecksumAddress(recipient),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 0n,
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
        poolAddress,
        depositAmount0,
        depositAmount1,
        depositLpAmount,
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
      );

      // Verify wrapper was updated
      expect(
        mockContext.ALM_LP_Wrapper?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      const wrapperUpdate = (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock
        .calls[0][0];
      // lpAmount is aggregated: diff.lpAmount + current.lpAmount
      // Deposit: lpAmount (1000) + current (2000) = 3000
      expect(wrapperUpdate.lpAmount).toBe(
        mockWrapper.lpAmount + depositLpAmount,
      );
      const depositDeltaL = computeLiquidityDeltaFromAmounts(
        depositAmount0,
        depositAmount1,
        mockSqrtPriceX96,
        mockWrapper.tickLower,
        mockWrapper.tickUpper,
      );
      expect(wrapperUpdate.liquidity).toBe(
        mockWrapper.liquidity + depositDeltaL,
      );

      // Verify user stats were updated
      expect(
        mockContext.UserStatsPerPool?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
    });

    it("should return early if wrapper not found", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const userStatsId = `${toChecksumAddress(recipient)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        undefined,
      );
      // Pre-create user stats so loadOrCreateUserData doesn't call set
      // (loadOrCreateUserData is called in parallel and may call set before we return early)
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce({
        id: userStatsId,
        userAddress: toChecksumAddress(recipient),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 0n,
      });

      await processDepositEvent(
        recipient,
        poolAddress,
        depositAmount0,
        depositAmount1,
        depositLpAmount,
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
      );

      // Should not update anything
      expect(
        mockContext.ALM_LP_Wrapper?.set as jest.Mock,
      ).toHaveBeenCalledTimes(0);
      expect(
        mockContext.UserStatsPerPool?.set as jest.Mock,
      ).toHaveBeenCalledTimes(0);
    });
  });

  describe("processWithdrawEvent", () => {
    let mockContext: handlerContext;
    const withdrawLpAmount = 500n * TEN_TO_THE_18_BI;

    beforeEach(() => {
      const mockPool = {
        sqrtPriceX96: mockSqrtPriceX96,
        isCL: true,
      };

      mockContext = {
        ALM_LP_Wrapper: {
          get: jest.fn(),
          set: jest.fn(),
        },
        UserStatsPerPool: {
          get: jest.fn(),
          set: jest.fn(),
        },
        LiquidityPoolAggregator: {
          get: jest.fn((poolAddr) => {
            if (poolAddr === poolId) {
              return Promise.resolve(mockPool);
            }
            return Promise.resolve(null);
          }),
        },
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
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const userStatsId = `${toChecksumAddress(sender)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const mockUserStats = {
        id: userStatsId,
        userAddress: toChecksumAddress(sender),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 1000n * TEN_TO_THE_18_BI,
      };

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        mockWrapper,
      );
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce(
        mockUserStats,
      );

      await processWithdrawEvent(
        sender,
        poolAddress,
        amount0,
        amount1,
        withdrawLpAmount,
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
        txHash,
        withdrawLogIndex,
        false, // isV1 = false for test (V2 behavior)
      );

      // Verify wrapper was updated
      expect(
        mockContext.ALM_LP_Wrapper?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      const wrapperUpdate = (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock
        .calls[0][0];
      // lpAmount is aggregated: diff.lpAmount + current.lpAmount
      // Withdraw: -lpAmount (-500) + current (2000) = 1500
      expect(wrapperUpdate.lpAmount).toBe(
        mockWrapper.lpAmount - withdrawLpAmount,
      );
      const withdrawDeltaL = computeLiquidityDeltaFromAmounts(
        amount0,
        amount1,
        mockSqrtPriceX96,
        mockWrapper.tickLower,
        mockWrapper.tickUpper,
      );
      const expectedLiquidity =
        mockWrapper.liquidity > withdrawDeltaL
          ? mockWrapper.liquidity - withdrawDeltaL
          : 0n;
      expect(wrapperUpdate.liquidity).toBe(expectedLiquidity);

      // Verify user stats were updated
      expect(
        mockContext.UserStatsPerPool?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
    });

    it("should return early if wrapper not found", async () => {
      const userStatsId = `${toChecksumAddress(sender)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        undefined,
      );
      // Pre-create user stats so loadOrCreateUserData doesn't call set
      // (loadOrCreateUserData is called in parallel and may call set before we return early)
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce({
        id: userStatsId,
        userAddress: toChecksumAddress(sender),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 0n,
      });

      await processWithdrawEvent(
        sender,
        poolAddress,
        amount0,
        amount1,
        withdrawLpAmount,
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
        txHash,
        withdrawLogIndex,
        false, // isV1 = false for test (V2 behavior)
      );

      // Should not update anything
      expect(
        mockContext.ALM_LP_Wrapper?.set as jest.Mock,
      ).toHaveBeenCalledTimes(0);
      expect(
        mockContext.UserStatsPerPool?.set as jest.Mock,
      ).toHaveBeenCalledTimes(0);
    });
  });

  describe("processTransferEvent", () => {
    let mockContext: handlerContext;

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
        pool: toChecksumAddress(poolAddress),
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const fromUserStatsId = `${toChecksumAddress(from)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const toUserStatsId = `${toChecksumAddress(to)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      const mockFromUserStats = {
        id: fromUserStatsId,
        userAddress: toChecksumAddress(from),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 1000n * TEN_TO_THE_18_BI,
      };

      const mockToUserStats = {
        id: toUserStatsId,
        userAddress: toChecksumAddress(to),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 0n,
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
        txHash,
        withdrawLogIndex,
        blockNumber,
        timestamp,
        mockContext,
        false, // isV1 = false for test
      );

      // Verify both user stats were updated
      // loadOrCreateUserData doesn't call set since both entities exist
      // updateUserStatsPerPool is called twice (once for sender, once for recipient)
      expect(
        mockContext.UserStatsPerPool?.set as jest.Mock,
      ).toHaveBeenCalledTimes(2);

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
        "0xtesttxhash",
        100,
        123456,
        timestamp,
        mockContext,
        false, // isV1 = false for test
      );

      // Burn: to zero address
      await processTransferEvent(
        from,
        ZERO_ADDRESS,
        value,
        srcAddress,
        chainId,
        "0xtesttxhash",
        100,
        123456,
        timestamp,
        mockContext,
        false, // isV1 = false for test
      );

      // Should not load wrapper or update any stats
      expect(
        mockContext.ALM_LP_Wrapper?.get as jest.Mock,
      ).toHaveBeenCalledTimes(0);
      expect(
        mockContext.UserStatsPerPool?.set as jest.Mock,
      ).toHaveBeenCalledTimes(0);
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
        txHash,
        withdrawLogIndex,
        blockNumber,
        timestamp,
        mockContext,
        false, // isV1 = false for test
      );

      // Should not update any stats
      expect(
        mockContext.UserStatsPerPool?.set as jest.Mock,
      ).toHaveBeenCalledTimes(0);
    });

    it("should return early when sender has no UserStatsPerPool", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      // Id format must match UserStatsPerPoolId(userAddress, poolAddress, chainId) from Constants - no checksum
      const poolInWrapper = toChecksumAddress(poolAddress);
      const fromUserStatsId = `${from}_${poolInWrapper}_${chainId}`;
      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce({
        ...mockALMLPWrapperData,
        id: wrapperId,
        pool: poolInWrapper,
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      });
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockImplementation(
        (id: string) =>
          Promise.resolve(
            id === fromUserStatsId
              ? undefined
              : {
                  id,
                  almLpAmount: 0n,
                  poolAddress: poolInWrapper,
                  chainId,
                  userAddress: toChecksumAddress(to),
                  almAddress: undefined,
                },
          ),
      );

      await processTransferEvent(
        from,
        to,
        value,
        srcAddress,
        chainId,
        txHash,
        transferLogIndex,
        blockNumber,
        timestamp,
        mockContext,
        false,
      );

      expect(
        mockContext.UserStatsPerPool?.set as jest.Mock,
      ).toHaveBeenCalledTimes(0);
    });

    it("should store burn Transfer event for V1 wrapper", async () => {
      const burnValue = 1000n * TEN_TO_THE_18_BI;

      mockContext = {
        ...mockContext,
        ALMLPWrapperTransferInTx: {
          set: jest.fn(),
        },
        // biome-ignore lint/suspicious/noExplicitAny: Mock context type extension needed for test
      } as any;

      await processTransferEvent(
        from,
        ZERO_ADDRESS, // Burn: to zero address
        burnValue,
        srcAddress,
        chainId,
        txHash,
        transferLogIndex,
        blockNumber,
        timestamp,
        mockContext,
        true, // isV1 = true - should store burn event
      );

      // Verify burn Transfer event was stored
      expect(
        // biome-ignore lint/suspicious/noExplicitAny: Mock context type extension needed for test
        (mockContext as any).ALMLPWrapperTransferInTx?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      const storedTransfer =
        // biome-ignore lint/suspicious/noExplicitAny: Mock context type extension needed for test
        ((mockContext as any).ALMLPWrapperTransferInTx?.set as jest.Mock).mock
          .calls[0][0];
      expect(storedTransfer.id).toBe(
        `${chainId}-${txHash}-${srcAddress}-${transferLogIndex}`,
      );
      expect(storedTransfer.chainId).toBe(chainId);
      expect(storedTransfer.txHash).toBe(txHash);
      expect(storedTransfer.wrapperAddress).toBe(srcAddress);
      expect(storedTransfer.logIndex).toBe(transferLogIndex);
      expect(storedTransfer.from).toBe(from);
      expect(storedTransfer.to).toBe(ZERO_ADDRESS);
      expect(storedTransfer.value).toBe(burnValue);
      expect(storedTransfer.isBurn).toBe(true);
      expect(storedTransfer.consumedByLogIndex).toBeUndefined();
    });

    it("should not store burn Transfer event for V2 wrapper", async () => {
      mockContext = {
        ...mockContext,
        ALMLPWrapperTransferInTx: {
          set: jest.fn(),
        },
        // biome-ignore lint/suspicious/noExplicitAny: Mock context type extension needed for test
      } as any;

      await processTransferEvent(
        from,
        ZERO_ADDRESS, // Burn: to zero address
        value,
        srcAddress,
        chainId,
        txHash,
        withdrawLogIndex,
        blockNumber,
        timestamp,
        mockContext,
        false, // isV1 = false - should NOT store burn event
      );

      // Verify burn Transfer event was NOT stored
      expect(
        // biome-ignore lint/suspicious/noExplicitAny: Mock context type extension needed for test
        (mockContext as any).ALMLPWrapperTransferInTx?.set as jest.Mock,
      ).toHaveBeenCalledTimes(0);
    });
  });

  describe("getMatchingBurnTransferInTx", () => {
    let mockContext: handlerContext;

    beforeEach(() => {
      mockContext = {
        ALMLPWrapperTransferInTx: {
          getWhere: {
            txHash: {
              eq: jest.fn(),
            },
          },
        },
        log: {
          warn: jest.fn(),
          error: jest.fn(),
        },
        // biome-ignore lint/suspicious/noExplicitAny: Mock context type extension needed for test
      } as any;
    });

    it("should find matching burn Transfer event", async () => {
      const matchingBurn = {
        id: `${chainId}-${txHash}-${srcAddress}-50`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: sender,
        isBurn: true,
        logIndex: 50,
        value: 1000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: undefined,
      };

      const otherBurn = {
        id: `${chainId}-${txHash}-${srcAddress}-60`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: sender,
        isBurn: true,
        logIndex: 60,
        value: 2000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: undefined,
      };

      const nonMatchingBurn = {
        id: `${chainId}-${txHash}-${srcAddress}-80`,
        chainId: chainId,
        wrapperAddress: "0xdifferentwrapper",
        from: sender,
        isBurn: true,
        logIndex: 80,
        value: 3000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: undefined,
      };

      (
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock
      ).mockResolvedValue([matchingBurn, otherBurn, nonMatchingBurn]);

      const result = await getMatchingBurnTransferInTx(
        txHash,
        sender,
        chainId,
        srcAddress,
        withdrawLogIndex,
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result?.id).toBe(otherBurn.id); // Should return the closest (highest logIndex)
      expect(result?.value).toBe(otherBurn.value);
      expect(result?.logIndex).toBe(60);
    });

    it("should return undefined if no matching burn found", async () => {
      (
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock
      ).mockResolvedValue([]);

      const result = await getMatchingBurnTransferInTx(
        txHash,
        sender,
        chainId,
        srcAddress,
        withdrawLogIndex,
        mockContext,
      );

      expect(result).toBeUndefined();
    });

    it("should filter out consumed transfers", async () => {
      const consumedBurn = {
        id: `${chainId}-${txHash}-${srcAddress}-50`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: sender,
        isBurn: true,
        logIndex: 50,
        value: 1000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: 90, // Already consumed
      };

      (
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock
      ).mockResolvedValue([consumedBurn]);

      const result = await getMatchingBurnTransferInTx(
        txHash,
        sender,
        chainId,
        srcAddress,
        withdrawLogIndex,
        mockContext,
      );

      expect(result).toBeUndefined();
    });

    it("should filter out transfers with logIndex >= withdrawLogIndex", async () => {
      const futureBurn = {
        id: `${chainId}-${txHash}-${srcAddress}-150`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: sender,
        isBurn: true,
        logIndex: 150, // After withdraw event
        value: 1000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: undefined,
      };

      (
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock
      ).mockResolvedValue([futureBurn]);

      const result = await getMatchingBurnTransferInTx(
        txHash,
        sender,
        chainId,
        srcAddress,
        withdrawLogIndex,
        mockContext,
      );

      expect(result).toBeUndefined();
    });

    it("should select closest preceding burn when multiple matches exist", async () => {
      const burn1 = {
        id: `${chainId}-${txHash}-${srcAddress}-30`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: sender,
        isBurn: true,
        logIndex: 30,
        value: 1000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: undefined,
      };

      const burn2 = {
        id: `${chainId}-${txHash}-${srcAddress}-70`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: sender,
        isBurn: true,
        logIndex: 70,
        value: 2000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: undefined,
      };

      const burn3 = {
        id: `${chainId}-${txHash}-${srcAddress}-90`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: sender,
        isBurn: true,
        logIndex: 90,
        value: 3000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: undefined,
      };

      (
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock
      ).mockResolvedValue([burn1, burn2, burn3]);

      const result = await getMatchingBurnTransferInTx(
        txHash,
        sender,
        chainId,
        srcAddress,
        withdrawLogIndex,
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result?.id).toBe(burn3.id); // Should return the closest (highest logIndex)
      expect(result?.value).toBe(burn3.value);
      expect(result?.logIndex).toBe(90);
    });

    it("should filter out burns from different senders", async () => {
      const differentSender = "0xdddddddddddddddddddddddddddddddddddddddd";
      const burnFromDifferentSender = {
        id: `${chainId}-${txHash}-${srcAddress}-50`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: differentSender, // Different sender
        isBurn: true,
        logIndex: 50,
        value: 1000n * TEN_TO_THE_18_BI,
        consumedByLogIndex: undefined,
      };

      (
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock
      ).mockResolvedValue([burnFromDifferentSender]);

      const result = await getMatchingBurnTransferInTx(
        txHash,
        sender,
        chainId,
        srcAddress,
        withdrawLogIndex,
        mockContext,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("processWithdrawEvent - V1 with Transfer matching", () => {
    let mockContext: handlerContext;

    beforeEach(() => {
      const mockPool = {
        sqrtPriceX96: mockSqrtPriceX96,
        isCL: true,
      };

      mockContext = {
        ALM_LP_Wrapper: {
          get: jest.fn(),
          set: jest.fn(),
        },
        UserStatsPerPool: {
          get: jest.fn(),
          set: jest.fn(),
        },
        LiquidityPoolAggregator: {
          get: jest.fn((poolAddr) => {
            if (poolAddr === poolId) {
              return Promise.resolve(mockPool);
            }
            return Promise.resolve(null);
          }),
        },
        ALMLPWrapperTransferInTx: {
          getWhere: {
            txHash: {
              eq: jest.fn(),
            },
          },
          get: jest.fn(),
          set: jest.fn(),
        },
        log: {
          warn: jest.fn(),
          error: jest.fn(),
          info: jest.fn(),
        },
        // biome-ignore lint/suspicious/noExplicitAny: Mock context type extension needed for test
      } as any;
    });

    it("should use Transfer event value for V1 withdraw when matching burn found", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const mockWrapper = {
        ...mockALMLPWrapperData,
        id: wrapperId,
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const userStatsId = `${toChecksumAddress(sender)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const mockUserStats = {
        id: userStatsId,
        userAddress: toChecksumAddress(sender),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 1000n * TEN_TO_THE_18_BI,
      };

      // Mock matching burn Transfer event
      const matchingBurn = {
        id: `${chainId}-${txHash}-${srcAddress}-${transferLogIndex}`,
        chainId: chainId,
        wrapperAddress: srcAddress,
        from: sender,
        isBurn: true,
        logIndex: transferLogIndex,
        value: actualBurnedAmount,
        consumedByLogIndex: undefined,
      };

      const transferEntity = {
        ...matchingBurn,
        blockNumber: BigInt(blockNumber),
        to: ZERO_ADDRESS,
        timestamp: timestamp,
      };

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        mockWrapper,
      );
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce(
        mockUserStats,
      );
      (
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock
      ).mockResolvedValue([matchingBurn]);
      (
        mockContext.ALMLPWrapperTransferInTx?.get as jest.Mock
      ).mockResolvedValue(transferEntity);

      await processWithdrawEvent(
        sender,
        poolAddress,
        amount0,
        amount1,
        suspiciousLpAmount, // Suspicious value (input parameter)
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
        txHash,
        withdrawLogIndex,
        true, // isV1 = true
      );

      // Verify wrapper was updated with actual burned amount (not the suspicious input parameter)
      expect(
        mockContext.ALM_LP_Wrapper?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      const wrapperUpdate = (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock
        .calls[0][0];
      // Should use actualBurnedAmount, not lpAmount
      expect(wrapperUpdate.lpAmount).toBe(
        mockWrapper.lpAmount - actualBurnedAmount,
      );
      const withdrawDeltaL = computeLiquidityDeltaFromAmounts(
        amount0,
        amount1,
        mockSqrtPriceX96,
        mockWrapper.tickLower,
        mockWrapper.tickUpper,
      );
      const expectedLiquidity =
        mockWrapper.liquidity > withdrawDeltaL
          ? mockWrapper.liquidity - withdrawDeltaL
          : 0n;
      expect(wrapperUpdate.liquidity).toBe(expectedLiquidity);

      // Verify Transfer event was marked as consumed
      expect(
        mockContext.ALMLPWrapperTransferInTx?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      const consumedTransfer = (
        mockContext.ALMLPWrapperTransferInTx?.set as jest.Mock
      ).mock.calls[0][0];
      expect(consumedTransfer.consumedByLogIndex).toBe(withdrawLogIndex);
    });

    it("should use 0n for V1 withdraw when no matching burn found", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const mockWrapper = {
        ...mockALMLPWrapperData,
        id: wrapperId,
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const userStatsId = `${toChecksumAddress(sender)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const mockUserStats = {
        id: userStatsId,
        userAddress: toChecksumAddress(sender),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 1000n * TEN_TO_THE_18_BI,
      };

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        mockWrapper,
      );
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce(
        mockUserStats,
      );
      // No matching burn Transfer event found
      (
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock
      ).mockResolvedValue([]);

      await processWithdrawEvent(
        sender,
        poolAddress,
        amount0,
        amount1,
        suspiciousLpAmount, // Suspicious value (input parameter)
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
        txHash,
        withdrawLogIndex,
        true, // isV1 = true
      );

      // Verify wrapper was updated with 0n (fallback when no Transfer found)
      expect(
        mockContext.ALM_LP_Wrapper?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      const wrapperUpdate = (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock
        .calls[0][0];
      expect(wrapperUpdate.lpAmount).toBe(mockWrapper.lpAmount - 0n);

      // Verify warning was logged
      expect(mockContext.log.warn as jest.Mock).toHaveBeenCalledTimes(1);
      expect((mockContext.log.warn as jest.Mock).mock.calls[0][0]).toContain(
        "no matching burn Transfer event found",
      );
    });

    it("should use event parameter directly for V2 withdraw", async () => {
      const wrapperId = `${srcAddress}_${chainId}`;
      const mockWrapper = {
        ...mockALMLPWrapperData,
        id: wrapperId,
        lpAmount: 2000n * TEN_TO_THE_18_BI,
      };

      const userStatsId = `${toChecksumAddress(sender)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const mockUserStats = {
        id: userStatsId,
        userAddress: toChecksumAddress(sender),
        poolAddress: toChecksumAddress(poolAddress),
        chainId: chainId,
        almLpAmount: 1000n * TEN_TO_THE_18_BI,
      };

      const normalLpAmount = 500n * TEN_TO_THE_18_BI; // Normal value for V2

      (mockContext.ALM_LP_Wrapper?.get as jest.Mock).mockResolvedValueOnce(
        mockWrapper,
      );
      (mockContext.UserStatsPerPool?.get as jest.Mock).mockResolvedValueOnce(
        mockUserStats,
      );

      await processWithdrawEvent(
        sender,
        poolAddress,
        amount0,
        amount1,
        normalLpAmount, // V2 emits actualLpAmount correctly
        srcAddress,
        chainId,
        blockNumber,
        timestamp,
        mockContext,
        txHash,
        withdrawLogIndex,
        false, // isV1 = false (V2)
      );

      // Verify wrapper was updated with event parameter (V2 is correct)
      expect(
        mockContext.ALM_LP_Wrapper?.set as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      const wrapperUpdate = (mockContext.ALM_LP_Wrapper?.set as jest.Mock).mock
        .calls[0][0];
      expect(wrapperUpdate.lpAmount).toBe(
        mockWrapper.lpAmount - normalLpAmount,
      );

      // Verify Transfer matching was NOT attempted (V2 doesn't need it)
      expect(
        mockContext.ALMLPWrapperTransferInTx?.getWhere?.txHash?.eq as jest.Mock,
      ).toHaveBeenCalledTimes(0);
    });
  });
});
