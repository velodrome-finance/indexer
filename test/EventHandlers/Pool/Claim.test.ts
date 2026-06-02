import type { Token } from "envio";
import { createTestIndexer } from "envio";
import type { MockInstance } from "vitest";
import { toChecksumAddress } from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import type { Pool as PoolEntity } from "../../../src/EntityTypes";
import * as PriceOracle from "../../../src/PriceOracle";
import { type MockPool, setupCommon } from "./common";

describe("Pool Claim Event", () => {
  let mockToken0Data: Token;
  let mockToken1Data: Token;
  let mockLiquidityPoolData: MockPool;
  let createMockPool: ReturnType<typeof setupCommon>["createMockPool"];
  let indexer: ReturnType<typeof createTestIndexer>;
  let mockPriceOracle: MockInstance;

  const chainId = 10 as const;
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
      const eventParams = {
        sender: toChecksumAddress("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        recipient: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        amount0: 1000n,
        amount1: 2000n,
      };
      const blockTimestamp = 1000000;
      const srcAddress = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );

      let updatedPool: PoolEntity | undefined;

      beforeEach(async () => {
        indexer.Pool.set(mockLiquidityPoolData);
        indexer.Token.set(mockToken0Data as Token);
        indexer.Token.set(mockToken1Data as Token);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Pool",
                  event: "Claim",
                  srcAddress: srcAddress,
                  logIndex: 1,
                  block: {
                    timestamp: blockTimestamp,
                    number: 123456,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: eventParams,
                },
              ],
            },
          },
        });

        const raw = await indexer.Pool.get(mockLiquidityPoolData.id);
        updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
      });

      it("should update staked fees collected amounts", () => {
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalStakedFeesCollected0).toBe(
          mockLiquidityPoolData.totalStakedFeesCollected0 + eventParams.amount0,
        );
        expect(updatedPool?.totalStakedFeesCollected1).toBe(
          mockLiquidityPoolData.totalStakedFeesCollected1 + eventParams.amount1,
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
          new Date(blockTimestamp * 1000),
        );
      });
    });

    describe("unstaked fees collection (sender is not gauge)", () => {
      const eventParams = {
        sender: toChecksumAddress("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"), // Regular user, not gauge
        recipient: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        amount0: 1000n,
        amount1: 2000n,
      };
      const blockTimestamp = 1000000;
      const srcAddress = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );

      let updatedPool: PoolEntity | undefined;

      beforeEach(async () => {
        indexer.Pool.set(mockLiquidityPoolData);
        indexer.Token.set(mockToken0Data as Token);
        indexer.Token.set(mockToken1Data as Token);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Pool",
                  event: "Claim",
                  srcAddress: srcAddress,
                  logIndex: 1,
                  block: {
                    timestamp: blockTimestamp,
                    number: 123456,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: eventParams,
                },
              ],
            },
          },
        });

        const raw = await indexer.Pool.get(mockLiquidityPoolData.id);
        updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
      });

      it("should update unstaked fees collected amounts", () => {
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalUnstakedFeesCollected0).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollected0 +
            eventParams.amount0,
        );
        expect(updatedPool?.totalUnstakedFeesCollected1).toBe(
          mockLiquidityPoolData.totalUnstakedFeesCollected1 +
            eventParams.amount1,
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
          new Date(blockTimestamp * 1000),
        );
      });
    });

    describe("edge cases", () => {
      it("should handle zero amounts", async () => {
        indexer.Pool.set(mockLiquidityPoolData);
        indexer.Token.set(mockToken0Data as Token);
        indexer.Token.set(mockToken1Data as Token);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Pool",
                  event: "Claim",
                  srcAddress: toChecksumAddress(
                    "0x3333333333333333333333333333333333333333",
                  ),
                  logIndex: 1,
                  block: {
                    timestamp: 1000000,
                    number: 123456,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    sender: gaugeAddress,
                    recipient: toChecksumAddress(
                      "0x5555555555555555555555555555555555555555",
                    ),
                    amount0: 0n,
                    amount1: 0n,
                  },
                },
              ],
            },
          },
        });

        const updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);

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

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Pool",
                  event: "Claim",
                  srcAddress: toChecksumAddress(
                    "0x3333333333333333333333333333333333333333",
                  ),
                  logIndex: 1,
                  block: {
                    timestamp: 1000000,
                    number: 123456,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    sender: gaugeAddress,
                    recipient: toChecksumAddress(
                      "0x5555555555555555555555555555555555555555",
                    ),
                    amount0: 1000n,
                    amount1: 2000n,
                  },
                },
              ],
            },
          },
        });

        const updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);

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
      const srcAddress = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Claim",
                srcAddress: srcAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  sender: gaugeAddress,
                  recipient: toChecksumAddress(
                    "0x5555555555555555555555555555555555555555",
                  ),
                  amount0: 1000n,
                  amount1: 2000n,
                },
              },
            ],
          },
        },
      });

      const pool = await indexer.Pool.get(toChecksumAddress(srcAddress));

      expect(pool).toBeUndefined();
      expect(mockPriceOracle).not.toHaveBeenCalled();
    });
  });
});
