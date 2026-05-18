import type { Token } from "envio";
import { createTestIndexer } from "envio";
import type { MockInstance } from "vitest";
import { toChecksumAddress } from "../../../src/Constants";
import type { Pool as PoolEntity } from "../../../src/EntityTypes";
import * as PriceOracle from "../../../src/PriceOracle";
import { simulateEvent } from "../../testHelpers";
import { type MockPool, setupCommon } from "./common";

describe("Pool Claim Event", () => {
  let mockToken0Data: Token;
  let mockToken1Data: Token;
  let mockLiquidityPoolData: MockPool;
  let createMockPool: ReturnType<typeof setupCommon>["createMockPool"];
  let indexer: ReturnType<typeof createTestIndexer>;
  let mockPriceOracle: MockInstance;

  const gaugeAddress = toChecksumAddress(
    "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  beforeEach(() => {
    const {
      mockToken0Data: token0,
      mockToken1Data: token1,
      createMockPool: builder,
    } = setupCommon();
    mockToken0Data = token0;
    mockToken1Data = token1;
    createMockPool = builder;
    mockLiquidityPoolData = createMockPool({
      gaugeAddress: gaugeAddress,
    });

    indexer = createTestIndexer();
    mockPriceOracle = vi
      .spyOn(PriceOracle, "refreshTokenPrice")
      .mockImplementation(async (...args) => {
        return args[0]; // Return the token that was passed in
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
        srcAddress: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
      };

      let updatedPool: PoolEntity | undefined;

      beforeEach(async () => {
        indexer.Pool.set(mockLiquidityPoolData);
        indexer.Token.set(mockToken0Data as Token);
        indexer.Token.set(mockToken1Data as Token);

        await simulateEvent(indexer, 10, {
          contract: "Pool",
          event: "Claim",
          params: {
            sender: eventData.sender,
            recipient: eventData.recipient,
            amount0: eventData.amount0,
            amount1: eventData.amount1,
          },
          block: eventData.block,
          srcAddress: eventData.srcAddress as `0x${string}`,
          logIndex: 1,
        });
        updatedPool = (await indexer.Pool.get(mockLiquidityPoolData.id)) as
          | PoolEntity
          | undefined;
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
        expect(
          new Date(
            updatedPool?.lastUpdatedTimestamp as unknown as string,
          ).getTime(),
        ).toBe(new Date(eventData.block.timestamp * 1000).getTime());
      });

      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should call refreshTokenPrice on token0", () => {
        expect(mockPriceOracle).toHaveBeenCalled();
        const calledToken = mockPriceOracle.mock.calls[0]?.[0];
        expect(calledToken?.address).toBe(mockToken0Data.address);
      });

      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should call refreshTokenPrice on token1", () => {
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
        srcAddress: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
      };

      let updatedPool: PoolEntity | undefined;

      beforeEach(async () => {
        indexer.Pool.set(mockLiquidityPoolData);
        indexer.Token.set(mockToken0Data as Token);
        indexer.Token.set(mockToken1Data as Token);

        await simulateEvent(indexer, 10, {
          contract: "Pool",
          event: "Claim",
          params: {
            sender: eventData.sender,
            recipient: eventData.recipient,
            amount0: eventData.amount0,
            amount1: eventData.amount1,
          },
          block: eventData.block,
          srcAddress: eventData.srcAddress as `0x${string}`,
          logIndex: 1,
        });
        updatedPool = (await indexer.Pool.get(mockLiquidityPoolData.id)) as
          | PoolEntity
          | undefined;
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
        expect(
          new Date(
            updatedPool?.lastUpdatedTimestamp as unknown as string,
          ).getTime(),
        ).toBe(new Date(eventData.block.timestamp * 1000).getTime());
      });
    });

    describe("edge cases", () => {
      it("should handle zero amounts", async () => {
        indexer.Pool.set(mockLiquidityPoolData);
        indexer.Token.set(mockToken0Data as Token);
        indexer.Token.set(mockToken1Data as Token);

        await simulateEvent(indexer, 10, {
          contract: "Pool",
          event: "Claim",
          params: {
            sender: gaugeAddress,
            recipient: toChecksumAddress(
              "0x5555555555555555555555555555555555555555",
            ),
            amount0: 0n,
            amount1: 0n,
          },
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          srcAddress: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ) as `0x${string}`,
          logIndex: 1,
        });
        const updatedPool = (await indexer.Pool.get(
          mockLiquidityPoolData.id,
        )) as PoolEntity | undefined;

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
        const poolWithoutGauge = createMockPool({
          gaugeAddress: undefined,
        });

        indexer.Pool.set(poolWithoutGauge);
        indexer.Token.set(mockToken0Data as Token);
        indexer.Token.set(mockToken1Data as Token);

        await simulateEvent(indexer, 10, {
          contract: "Pool",
          event: "Claim",
          params: {
            sender: gaugeAddress,
            recipient: toChecksumAddress(
              "0x5555555555555555555555555555555555555555",
            ),
            amount0: 1000n,
            amount1: 2000n,
          },
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          srcAddress: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ) as `0x${string}`,
          logIndex: 1,
        });
        const updatedPool = (await indexer.Pool.get(
          mockLiquidityPoolData.id,
        )) as PoolEntity | undefined;

        // Should be treated as unstaked since gaugeAddress is undefined
        expect(updatedPool?.totalUnstakedFeesCollected0).toBe(
          poolWithoutGauge.totalUnstakedFeesCollected0 + 1000n,
        );
        expect(updatedPool?.totalStakedFeesCollected0).toBe(
          poolWithoutGauge.totalStakedFeesCollected0,
        );
      });
    });
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      const freshIndexer = createTestIndexer();
      // Note: We don't seed any pool

      await simulateEvent(freshIndexer, 10, {
        contract: "Pool",
        event: "Claim",
        params: {
          sender: gaugeAddress,
          recipient: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ),
          amount0: 1000n,
          amount1: 2000n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        srcAddress: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ) as `0x${string}`,
        logIndex: 1,
      });

      const pool = await freshIndexer.Pool.get(
        toChecksumAddress("0x3333333333333333333333333333333333333333"),
      );

      expect(pool).toBeUndefined();
    });
  });
});
