import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
} from "../../../generated/src/Types.gen";
import {
  OUSDT_ADDRESS,
  PoolId,
  TEN_TO_THE_18_BI,
  TokenIdByChain,
  toChecksumAddress,
} from "../../../src/Constants";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "./common";

describe("Pool Swap Event", () => {
  let mockToken0Data: Token;
  let mockToken1Data: Token;
  let mockLiquidityPoolData: LiquidityPoolAggregator;

  const expectations = {
    swapAmount0In: 0n,
    swapAmount1Out: 0n,
    expectedNetAmount0: 0n,
    expectedNetAmount1: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    expectedLPVolumeUSD0: 0n,
    expectedLPVolumeUSD1: 0n,
    totalVolumeUSDWhitelisted: 0n,
  };

  const eventData = {
    sender: toChecksumAddress("0x4444444444444444444444444444444444444444"),
    to: toChecksumAddress("0x5555555555555555555555555555555555555555"),
    amount0In: 0n,
    amount1In: 0n,
    amount0Out: 0n,
    amount1Out: 0n,
    mockEventData: {
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
    },
  };

  let mockPriceOracle: jest.SpyInstance;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    const setupData = setupCommon();
    mockToken0Data = setupData.mockToken0Data;
    mockToken1Data = setupData.mockToken1Data;
    mockLiquidityPoolData = setupData.mockLiquidityPoolData;

    expectations.swapAmount0In = 100n * 10n ** mockToken0Data.decimals;
    expectations.swapAmount1Out = 99n * 10n ** mockToken1Data.decimals;

    expectations.expectedNetAmount0 = expectations.swapAmount0In;

    expectations.expectedNetAmount1 = expectations.swapAmount1Out;

    expectations.totalVolume0 =
      mockLiquidityPoolData.totalVolume0 + expectations.swapAmount0In;
    expectations.totalVolume1 =
      mockLiquidityPoolData.totalVolume1 + expectations.swapAmount1Out;

    // The code expects pricePerUSDNew to be normalized to 1e18
    expectations.expectedLPVolumeUSD0 =
      mockLiquidityPoolData.totalVolumeUSD +
      expectations.expectedNetAmount0 *
        (TEN_TO_THE_18_BI / 10n ** mockToken0Data.decimals) *
        (mockToken0Data.pricePerUSDNew / TEN_TO_THE_18_BI);

    expectations.expectedLPVolumeUSD1 =
      mockLiquidityPoolData.totalVolumeUSD +
      expectations.expectedNetAmount1 *
        (TEN_TO_THE_18_BI / 10n ** mockToken1Data.decimals) *
        (mockToken1Data.pricePerUSDNew / TEN_TO_THE_18_BI);

    expectations.totalVolumeUSDWhitelisted = expectations.expectedLPVolumeUSD0;

    mockPriceOracle = jest
      .spyOn(PriceOracle, "refreshTokenPrice")
      .mockImplementation(async (...args) => {
        return args[0]; // Return the token that was passed in
      });

    mockDb = MockDb.createMockDb();
    eventData.amount0In = expectations.swapAmount0In;
    eventData.amount1Out = expectations.swapAmount1Out;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("when both tokens exist", () => {
    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let updatedPool: LiquidityPoolAggregator | undefined;

    beforeEach(async () => {
      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData as LiquidityPoolAggregator,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data as Token);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data as Token);

      const mockEvent = Pool.Swap.createMockEvent(eventData);

      postEventDB = await Pool.Swap.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });
      updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
        PoolId(
          eventData.mockEventData.chainId,
          eventData.mockEventData.srcAddress,
        ),
      );
    });

    it("should update UserStatsPerPool with swap activity", async () => {
      const userStats = postEventDB.entities.UserStatsPerPool.get(
        `${eventData.sender}_${eventData.mockEventData.srcAddress}_${eventData.mockEventData.chainId}`,
      );
      expect(userStats).toBeDefined();
      expect(userStats?.userAddress).toBe(eventData.sender);
      expect(userStats?.poolAddress).toBe(eventData.mockEventData.srcAddress);
      expect(userStats?.chainId).toBe(eventData.mockEventData.chainId);
      expect(userStats?.numberOfSwaps).toBe(1n);
      expect(userStats?.totalSwapVolumeUSD).toBe(100000000000000000000n); // 100 tokens * 1 USD
      expect(userStats?.lastActivityTimestamp).toEqual(
        new Date(eventData.mockEventData.block.timestamp * 1000),
      );
    });

    it("should update the Liquidity Pool aggregator", async () => {
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.totalVolume0).toBe(expectations.totalVolume0);
      expect(updatedPool?.totalVolume1).toBe(expectations.totalVolume1);
      expect(updatedPool?.totalVolumeUSD).toBe(
        expectations.expectedLPVolumeUSD0,
      );
      expect(updatedPool?.totalVolumeUSDWhitelisted).toBe(
        expectations.totalVolumeUSDWhitelisted,
      );
      expect(updatedPool?.numberOfSwaps).toBe(
        mockLiquidityPoolData.numberOfSwaps + 1n,
      );
      expect(updatedPool?.lastUpdatedTimestamp).toEqual(
        new Date(eventData.mockEventData.block.timestamp * 1000),
      );
    });
    it("should call refreshTokenPrice on token0", () => {
      const calledToken = mockPriceOracle.mock.calls[0][0];
      expect(calledToken.address).toBe(mockToken0Data.address);
    });
    it("should call refreshTokenPrice on token1", () => {
      const calledToken = mockPriceOracle.mock.calls[1][0];
      expect(calledToken.address).toBe(mockToken1Data.address);
    });
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a mockDb without the pool
      const updatedDB1 = mockDb.entities.Token.set(mockToken0Data as Token);
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken1Data as Token);
      // Note: We intentionally don't set the LiquidityPoolAggregator

      const mockEvent = Pool.Swap.createMockEvent(eventData);

      const postEventDB = await Pool.Swap.processEvent({
        event: mockEvent,
        mockDb: updatedDB2,
      });

      // Pool should not exist
      const pool = postEventDB.entities.LiquidityPoolAggregator.get(
        PoolId(
          eventData.mockEventData.chainId,
          eventData.mockEventData.srcAddress,
        ),
      );
      expect(pool).toBeUndefined();

      // User stats will still be created because loadOrCreateUserData is called in parallel
      // but they should have default/zero values since no swap processing occurred
      const userStats = postEventDB.entities.UserStatsPerPool.get(
        `${eventData.sender}_${eventData.mockEventData.srcAddress}_${eventData.mockEventData.chainId}`,
      );
      expect(userStats).toBeDefined();
      // Verify no swap activity was recorded
      expect(userStats?.numberOfSwaps).toBe(0n);
      expect(userStats?.totalSwapVolumeUSD).toBe(0n);
    });
  });

  describe("when OUSDT is involved", () => {
    it("should create OUSDTSwap entity when token0 is OUSDT", async () => {
      const ousdtAddress = toChecksumAddress(OUSDT_ADDRESS);
      const ousdtToken: Token = {
        ...mockToken0Data,
        address: ousdtAddress,
        id: TokenIdByChain(ousdtAddress, 10),
      };

      // Update pool to reference OUSDT token
      const poolWithOusdt: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        token0_id: ousdtToken.id,
        token0_address: ousdtAddress,
      };

      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
        poolWithOusdt as LiquidityPoolAggregator,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(ousdtToken as Token);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data as Token);

      const mockEvent = Pool.Swap.createMockEvent({
        ...eventData,
        amount0In: 100n * 10n ** 18n,
        amount1Out: 99n * 10n ** 18n,
      });

      const postEventDB = await Pool.Swap.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });

      // Check that OUSDTSwap entity was created
      const ousdtSwaps = Array.from(postEventDB.entities.OUSDTSwaps.getAll());
      expect(ousdtSwaps.length).toBe(1);
      expect(ousdtSwaps[0]?.tokenInPool).toBe(ousdtAddress);
      expect(ousdtSwaps[0]?.amountIn).toBe(100n * 10n ** 18n);
    });

    it("should create OUSDTSwap entity when token1 is OUSDT", async () => {
      const ousdtAddress = toChecksumAddress(OUSDT_ADDRESS);
      const ousdtToken: Token = {
        ...mockToken1Data,
        address: ousdtAddress,
        id: TokenIdByChain(ousdtAddress, 10),
      };

      // Update pool to reference OUSDT token
      const poolWithOusdt: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        token1_id: ousdtToken.id,
        token1_address: ousdtAddress,
      };

      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
        poolWithOusdt as LiquidityPoolAggregator,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data as Token);
      const updatedDB3 = updatedDB2.entities.Token.set(ousdtToken as Token);

      const mockEvent = Pool.Swap.createMockEvent({
        ...eventData,
        amount0In: 0n, // Explicitly set to 0 to ensure token1 is the input
        amount1In: 100n * 10n ** 18n,
        amount0Out: 99n * 10n ** 18n,
        amount1Out: 0n, // Explicitly set to 0
      });

      const postEventDB = await Pool.Swap.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });

      // Check that OUSDTSwap entity was created
      const ousdtSwaps = Array.from(postEventDB.entities.OUSDTSwaps.getAll());
      expect(ousdtSwaps.length).toBe(1);
      expect(ousdtSwaps[0]?.tokenInPool).toBe(ousdtAddress);
      expect(ousdtSwaps[0]?.tokenOutPool).toBe(mockToken0Data.address);
      expect(ousdtSwaps[0]?.amountIn).toBe(100n * 10n ** 18n);
      expect(ousdtSwaps[0]?.amountOut).toBe(99n * 10n ** 18n);
    });

    it("should not create OUSDTSwap entity when neither token is OUSDT", async () => {
      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData as LiquidityPoolAggregator,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data as Token);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data as Token);

      const mockEvent = Pool.Swap.createMockEvent(eventData);

      const postEventDB = await Pool.Swap.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });

      // Check that no OUSDTSwap entity was created
      const ousdtSwaps = Array.from(postEventDB.entities.OUSDTSwaps.getAll());
      expect(ousdtSwaps.length).toBe(0);
    });
  });
});
