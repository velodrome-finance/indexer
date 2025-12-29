import { Pool } from "../../../generated/src/TestHelpers.gen";
import { processPoolLiquidityEvent } from "../../../src/EventHandlers/Pool/PoolBurnAndMintLogic";
import * as Helpers from "../../../src/Helpers";
import { setupCommon } from "./common";

describe("processPoolLiquidityEvent", () => {
  const commonData = setupCommon();

  const mockContext = {
    log: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    isPreload: false,
    effect: () => Promise.resolve(),
  } as unknown as Parameters<typeof processPoolLiquidityEvent>[6];

  describe("Mint events", () => {
    it("should return liquidity pool diff with correct timestamp", async () => {
      const mockEvent = Pool.Mint.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        amount0: 1000n * 10n ** 18n,
        amount1: 2000n * 10n ** 18n,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const result = await processPoolLiquidityEvent(
        mockEvent,
        commonData.mockLiquidityPoolData,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
        mockContext,
      );

      // Verify the function returns the expected structure
      expect(result).toHaveProperty("liquidityPoolDiff");
      expect(result.liquidityPoolDiff).toBeDefined();

      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
      // These values should match what updateReserveTokenData returns
      expect(result.liquidityPoolDiff?.token0Price).toBe(1000000000000000000n);
      expect(result.liquidityPoolDiff?.token1Price).toBe(1000000000000000000n);
      expect(result.liquidityPoolDiff?.token0IsWhitelisted).toBe(true);
      expect(result.liquidityPoolDiff?.token1IsWhitelisted).toBe(true);
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).toBe(
        2000000000001000000000000000000000n,
      );
    });

    it("should return positive user liquidity diff for mint events", async () => {
      const amount0 = 1000n * 10n ** 18n;
      const amount1 = 2000n * 10n ** 18n;

      const mockEvent = Pool.Mint.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        amount0,
        amount1,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const result = await processPoolLiquidityEvent(
        mockEvent,
        commonData.mockLiquidityPoolData,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
        mockContext,
      );

      // For mint events, user liquidity should be positive (adding liquidity)
      expect(result.userLiquidityDiff).toBeDefined();
      expect(result.userLiquidityDiff?.currentLiquidityToken0).toBe(amount0);
      expect(result.userLiquidityDiff?.currentLiquidityToken1).toBe(amount1);
      expect(result.userLiquidityDiff?.currentLiquidityUSD).toBeGreaterThan(0n);
      // For mint events, totalLiquidityAddedUSD should be set
      expect(result.userLiquidityDiff?.totalLiquidityAddedUSD).toBeDefined();
      expect(result.userLiquidityDiff?.totalLiquidityAddedUSD).toBeGreaterThan(
        0n,
      );
      // For mint events, totalLiquidityRemovedUSD should be 0n
      expect(result.userLiquidityDiff?.totalLiquidityRemovedUSD).toBe(0n);
      expect(result.userLiquidityDiff?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });

  describe("Burn events", () => {
    it("should return negative user liquidity diff for burn events", async () => {
      const amount0 = 500n * 10n ** 18n;
      const amount1 = 1000n * 10n ** 18n;

      const mockEvent = Pool.Burn.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        amount0,
        amount1,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const result = await processPoolLiquidityEvent(
        mockEvent,
        commonData.mockLiquidityPoolData,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
        mockContext,
      );

      // For burn events, user liquidity should be negative (removing liquidity)
      expect(result.userLiquidityDiff).toBeDefined();
      expect(result.userLiquidityDiff?.currentLiquidityToken0).toBe(-amount0);
      expect(result.userLiquidityDiff?.currentLiquidityToken1).toBe(-amount1);
      expect(result.userLiquidityDiff?.currentLiquidityUSD).toBeLessThan(0n);
      // For burn events, totalLiquidityRemovedUSD should be set
      expect(result.userLiquidityDiff?.totalLiquidityRemovedUSD).toBeDefined();
      expect(
        result.userLiquidityDiff?.totalLiquidityRemovedUSD,
      ).toBeGreaterThan(0n);
      // For burn events, totalLiquidityAddedUSD should be 0n
      expect(result.userLiquidityDiff?.totalLiquidityAddedUSD).toBe(0n);
      expect(result.userLiquidityDiff?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });

  describe("Fallback branches (nullish coalescing)", () => {
    let updateReserveTokenDataSpy: jest.SpyInstance;

    beforeEach(() => {
      updateReserveTokenDataSpy = jest.spyOn(Helpers, "updateReserveTokenData");
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const createMintEvent = () =>
      Pool.Mint.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        amount0: 1000n * 10n ** 18n,
        amount1: 2000n * 10n ** 18n,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

    const createMockReserveData = (
      overrides: Partial<
        Awaited<ReturnType<typeof Helpers.updateReserveTokenData>>
      > = {},
    ) => ({
      token0: commonData.mockToken0Data,
      token1: commonData.mockToken1Data,
      totalLiquidityUSD: 2000000000001000000000000000000000n,
      ...overrides,
    });

    it("should use fallback values when token0 data is undefined", async () => {
      const mockEvent = createMintEvent();
      updateReserveTokenDataSpy.mockResolvedValue(
        createMockReserveData({ token0: undefined }),
      );

      const result = await processPoolLiquidityEvent(
        mockEvent,
        commonData.mockLiquidityPoolData,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token0Price).toBe(
        commonData.mockLiquidityPoolData.token0Price,
      );
      expect(result.liquidityPoolDiff?.token0IsWhitelisted).toBe(
        commonData.mockLiquidityPoolData.token0IsWhitelisted,
      );
      expect(result.liquidityPoolDiff?.token1Price).toBe(
        commonData.mockToken1Data.pricePerUSDNew,
      );
    });

    it("should use fallback values when token1 data is undefined", async () => {
      const mockEvent = createMintEvent();
      updateReserveTokenDataSpy.mockResolvedValue(
        createMockReserveData({ token1: undefined }),
      );

      const result = await processPoolLiquidityEvent(
        mockEvent,
        commonData.mockLiquidityPoolData,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token1Price).toBe(
        commonData.mockLiquidityPoolData.token1Price,
      );
      expect(result.liquidityPoolDiff?.token1IsWhitelisted).toBe(
        commonData.mockLiquidityPoolData.token1IsWhitelisted,
      );
      expect(result.liquidityPoolDiff?.token0Price).toBe(
        commonData.mockToken0Data.pricePerUSDNew,
      );
    });

    it("should use fallback value when totalLiquidityUSD is undefined", async () => {
      const mockEvent = createMintEvent();
      updateReserveTokenDataSpy.mockResolvedValue(
        createMockReserveData({
          totalLiquidityUSD: undefined,
        }) as unknown as Awaited<
          ReturnType<typeof Helpers.updateReserveTokenData>
        >,
      );

      const result = await processPoolLiquidityEvent(
        mockEvent,
        commonData.mockLiquidityPoolData,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.totalLiquidityUSD).toBe(
        commonData.mockLiquidityPoolData.totalLiquidityUSD,
      );
    });

    it("should use fallback values when both tokens are undefined", async () => {
      const mockEvent = Pool.Burn.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        amount0: 500n * 10n ** 18n,
        amount1: 1000n * 10n ** 18n,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      updateReserveTokenDataSpy.mockResolvedValue(
        createMockReserveData({
          token0: undefined,
          token1: undefined,
        }),
      );

      const result = await processPoolLiquidityEvent(
        mockEvent,
        commonData.mockLiquidityPoolData,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token0Price).toBe(
        commonData.mockLiquidityPoolData.token0Price,
      );
      expect(result.liquidityPoolDiff?.token1Price).toBe(
        commonData.mockLiquidityPoolData.token1Price,
      );
      expect(result.liquidityPoolDiff?.token0IsWhitelisted).toBe(
        commonData.mockLiquidityPoolData.token0IsWhitelisted,
      );
      expect(result.liquidityPoolDiff?.token1IsWhitelisted).toBe(
        commonData.mockLiquidityPoolData.token1IsWhitelisted,
      );
    });
  });
});
