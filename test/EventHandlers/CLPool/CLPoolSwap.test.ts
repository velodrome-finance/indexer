import { createTestIndexer } from "envio";
import type { MockInstance } from "vitest";
import { UserStatsPerPoolId, toChecksumAddress } from "../../../src/Constants";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "../Pool/common";

// #814: per-user swap stats must accrue to the transaction signer (the user),
// not params.sender — which for routed swaps is the router/aggregator contract.
describe("CLPool Swap Event — attribution target (#814)", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  let mockPriceOracle: MockInstance;
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const chainId = 10 as const;

  const router = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  // Lower-cased and full of hex letters so its EIP-55 form differs from input.
  const userLower = "0xaaaabbbbccccddddeeeeffff0000111122223333";
  const userChecksummed = toChecksumAddress(userLower);

  beforeEach(async () => {
    mockPriceOracle = vi
      .spyOn(PriceOracle, "refreshTokenPrice")
      .mockImplementation(async (...args) => args[0]);

    indexer = createTestIndexer();
    indexer.Pool.set(mockLiquidityPoolData);
    indexer.Token.set(mockToken0Data);
    indexer.Token.set(mockToken1Data);

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLPool",
              event: "Swap",
              srcAddress: poolAddress as `0x${string}`,
              logIndex: 1,
              block: {
                timestamp: 1000000,
                number: 123456,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              transaction: { from: userLower },
              params: {
                sender: router,
                recipient: toChecksumAddress(
                  "0x5555555555555555555555555555555555555555",
                ),
                amount0: 1n * 10n ** 18n,
                amount1: -2n * 10n ** 18n,
                sqrtPriceX96: 2000000000000000000000000000000n,
                liquidity: 1000000000000000000000n,
                tick: 1000n,
              },
            },
          ],
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attributes the swap to tx.from (the user)", async () => {
    const userStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, userChecksummed, poolAddress),
    );
    expect(userStats).toBeDefined();
    expect(userStats?.userAddress).toBe(userChecksummed);
    expect(userStats?.numberOfSwaps).toBe(1n);
  });

  it("does not attribute the swap to params.sender (the router)", async () => {
    const routerStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, router, poolAddress),
    );
    expect(routerStats).toBeUndefined();
  });
});
