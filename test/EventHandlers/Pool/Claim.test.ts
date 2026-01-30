import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
} from "../../../generated/src/Types.gen";
import { toChecksumAddress } from "../../../src/Constants";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "./common";

describe("Pool Claim Event", () => {
  let mockToken0Data: Token;
  let mockToken1Data: Token;
  let mockLiquidityPoolData: LiquidityPoolAggregator;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let mockPriceOracle: jest.SpyInstance;

  const gaugeAddress = toChecksumAddress(
    "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  beforeEach(() => {
    const {
      mockToken0Data: token0,
      mockToken1Data: token1,
      mockLiquidityPoolData: pool,
    } = setupCommon();
    mockToken0Data = token0;
    mockToken1Data = token1;
    mockLiquidityPoolData = {
      ...pool,
      gaugeAddress: gaugeAddress,
    } as LiquidityPoolAggregator;

    mockDb = MockDb.createMockDb();
    mockPriceOracle = jest
      .spyOn(PriceOracle, "refreshTokenPrice")
      .mockImplementation(async (...args) => {
        return args[0]; // Return the token that was passed in
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("when pool exists", () => {
    describe("staked fees collection (sender is gauge)", () => {
      const eventData = {
        sender: gaugeAddress,
        recipient: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        amount0: 1000n,
        amount1: 2000n,
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

      let postEventDB: ReturnType<typeof MockDb.createMockDb>;
      let updatedPool: LiquidityPoolAggregator | undefined;

      beforeEach(async () => {
        const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
          mockLiquidityPoolData as LiquidityPoolAggregator,
        );
        const updatedDB2 = updatedDB1.entities.Token.set(
          mockToken0Data as Token,
        );
        const updatedDB3 = updatedDB2.entities.Token.set(
          mockToken1Data as Token,
        );

        const mockEvent = Pool.Claim.createMockEvent(eventData);

        postEventDB = await Pool.Claim.processEvent({
          event: mockEvent,
          mockDb: updatedDB3,
        });
        updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPoolData.id,
        );
      });

      it("should update staked fees collected amounts", () => {
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalStakedFeesCollected0).toBe(
          mockLiquidityPoolData.totalStakedFeesCollected0 + eventData.amount0,
        );
        expect(updatedPool?.totalStakedFeesCollected1).toBe(
          mockLiquidityPoolData.totalStakedFeesCollected1 + eventData.amount1,
        );
      });

      it("should not update unstaked fees collected", () => {
        expect(updatedPool?.totalUnstakedFeesCollected0).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollected0,
        );
        expect(updatedPool?.totalUnstakedFeesCollected1).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollected1,
        );
      });

      it("should calculate USD correctly for staked fees", () => {
        // Calculate expected USD values
        // token0: 1000n (18 decimals) * 1 USD = 1000n USD (normalized to 1e18)
        // token1: 2000n (6 decimals) * 1 USD = 2000n * 10^12 = 2000000000000000n USD (normalized to 1e18)
        // totalFeesUSD = 1000n + 2000000000000000n = 2000000000001000n
        const expectedToken0FeesUSD = 1000n;
        const expectedToken1FeesUSD = 2000000000000000n;
        const expectedTotalFeesUSD =
          expectedToken0FeesUSD + expectedToken1FeesUSD; // 2000000000001000n

        expect(updatedPool?.totalStakedFeesCollectedUSD).toBe(
          mockLiquidityPoolData.totalStakedFeesCollectedUSD +
            expectedTotalFeesUSD,
        );
      });

      it("should update lastUpdatedTimestamp", () => {
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(eventData.mockEventData.block.timestamp * 1000),
        );
      });

      it("should call refreshTokenPrice on token0", () => {
        expect(mockPriceOracle).toHaveBeenCalled();
        const calledToken = mockPriceOracle.mock.calls[0]?.[0];
        expect(calledToken?.address).toBe(mockToken0Data.address);
      });

      it("should call refreshTokenPrice on token1", () => {
        expect(mockPriceOracle).toHaveBeenCalled();
        const calledToken = mockPriceOracle.mock.calls[1]?.[0];
        expect(calledToken?.address).toBe(mockToken1Data.address);
      });
    });

    describe("unstaked fees collection (sender is not gauge)", () => {
      const eventData = {
        sender: toChecksumAddress("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"), // Regular user, not gauge
        recipient: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        amount0: 1000n,
        amount1: 2000n,
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

      let postEventDB: ReturnType<typeof MockDb.createMockDb>;
      let updatedPool: LiquidityPoolAggregator | undefined;

      beforeEach(async () => {
        const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
          mockLiquidityPoolData as LiquidityPoolAggregator,
        );
        const updatedDB2 = updatedDB1.entities.Token.set(
          mockToken0Data as Token,
        );
        const updatedDB3 = updatedDB2.entities.Token.set(
          mockToken1Data as Token,
        );

        const mockEvent = Pool.Claim.createMockEvent(eventData);

        postEventDB = await Pool.Claim.processEvent({
          event: mockEvent,
          mockDb: updatedDB3,
        });
        updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPoolData.id,
        );
      });

      it("should update unstaked fees collected amounts", () => {
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalUnstakedFeesCollected0).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollected0 + eventData.amount0,
        );
        expect(updatedPool?.totalUnstakedFeesCollected1).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollected1 + eventData.amount1,
        );
      });

      it("should not update staked fees collected", () => {
        expect(updatedPool?.totalStakedFeesCollected0).toBe(
          mockLiquidityPoolData.totalStakedFeesCollected0,
        );
        expect(updatedPool?.totalStakedFeesCollected1).toBe(
          mockLiquidityPoolData.totalStakedFeesCollected1,
        );
      });

      it("should calculate USD correctly for unstaked fees", () => {
        const expectedToken0FeesUSD = 1000n;
        const expectedToken1FeesUSD = 2000000000000000n;
        const expectedTotalFeesUSD =
          expectedToken0FeesUSD + expectedToken1FeesUSD; // 2000000000001000n

        expect(updatedPool?.totalUnstakedFeesCollectedUSD).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollectedUSD +
            expectedTotalFeesUSD,
        );
      });

      it("should update lastUpdatedTimestamp", () => {
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(eventData.mockEventData.block.timestamp * 1000),
        );
      });
    });

    describe("edge cases", () => {
      it("should handle zero amounts", async () => {
        const eventData = {
          sender: gaugeAddress,
          recipient: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ),
          amount0: 0n,
          amount1: 0n,
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

        const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
          mockLiquidityPoolData as LiquidityPoolAggregator,
        );
        const updatedDB2 = updatedDB1.entities.Token.set(
          mockToken0Data as Token,
        );
        const updatedDB3 = updatedDB2.entities.Token.set(
          mockToken1Data as Token,
        );

        const mockEvent = Pool.Claim.createMockEvent(eventData);

        const postEventDB = await Pool.Claim.processEvent({
          event: mockEvent,
          mockDb: updatedDB3,
        });
        const updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPoolData.id,
        );

        expect(updatedPool?.totalStakedFeesCollected0).toBe(
          mockLiquidityPoolData.totalStakedFeesCollected0,
        );
        expect(updatedPool?.totalStakedFeesCollected1).toBe(
          mockLiquidityPoolData.totalStakedFeesCollected1,
        );
        expect(updatedPool?.totalStakedFeesCollectedUSD).toBe(
          mockLiquidityPoolData.totalStakedFeesCollectedUSD,
        );
        expect(updatedPool?.totalUnstakedFeesCollected0).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollected0,
        );
        expect(updatedPool?.totalUnstakedFeesCollected1).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollected1,
        );
      });

      it("should handle case when gauge address is undefined", async () => {
        const poolWithoutGauge = {
          ...mockLiquidityPoolData,
          gaugeAddress: undefined,
        } as LiquidityPoolAggregator;

        const eventData = {
          sender: gaugeAddress,
          recipient: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ),
          amount0: 1000n,
          amount1: 2000n,
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

        const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
          poolWithoutGauge as LiquidityPoolAggregator,
        );
        const updatedDB2 = updatedDB1.entities.Token.set(
          mockToken0Data as Token,
        );
        const updatedDB3 = updatedDB2.entities.Token.set(
          mockToken1Data as Token,
        );

        const mockEvent = Pool.Claim.createMockEvent(eventData);

        const postEventDB = await Pool.Claim.processEvent({
          event: mockEvent,
          mockDb: updatedDB3,
        });
        const updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPoolData.id,
        );

        // Should be treated as unstaked since gaugeAddress is undefined
        expect(updatedPool?.totalUnstakedFeesCollected0).toBe(
          poolWithoutGauge.totalUnstakedFeesCollected0 + eventData.amount0,
        );
        expect(updatedPool?.totalStakedFeesCollected0).toBe(
          poolWithoutGauge.totalStakedFeesCollected0,
        );
      });
    });
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      const eventData = {
        sender: gaugeAddress,
        recipient: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        amount0: 1000n,
        amount1: 2000n,
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

      const mockEvent = Pool.Claim.createMockEvent(eventData);

      const postEventDB = await Pool.Claim.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });

      const pool = postEventDB.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(eventData.mockEventData.srcAddress),
      );

      expect(pool).toBeUndefined();
      expect(mockPriceOracle).not.toHaveBeenCalled();
    });
  });
});
