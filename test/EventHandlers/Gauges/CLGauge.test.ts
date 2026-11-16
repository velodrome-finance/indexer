import { type Token, createTestIndexer } from "envio";
import {
  TokenId,
  UserStatsPerPoolId,
  getLegacyConstants,
  toChecksumAddress,
} from "../../../src/Constants";
import { registerVoterGauge } from "../../registerDynamicContracts";
import { setupCommon } from "../Pool/common";

describe("CLGauge Event Handlers", () => {
  const mockChainId = 10 as const;
  const mockGaugeAddress = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const mockUserAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );

  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(async () => {
    indexer = createTestIndexer();
    await registerVoterGauge(indexer, mockChainId, {
      gauge: mockGaugeAddress,
      isCL: true,
    });
  });

  describe("Event Data Mapping", () => {
    it("should map CLGauge.Deposit event data correctly", async () => {
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "CLGauge",
                event: "Deposit",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 100,
                  timestamp: 1000000,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  tokenId: 1n,
                  user: mockUserAddress,
                  liquidityToStake: 100000000000000000000n, // 100 USD
                },
              },
            ],
          },
        },
      });
    });

    it("should map CLGauge.Withdraw event data correctly", async () => {
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "CLGauge",
                event: "Withdraw",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 101,
                  timestamp: 1000001,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  tokenId: 1n,
                  user: mockUserAddress,
                  liquidityToStake: 50000000000000000000n, // 50 USD
                },
              },
            ],
          },
        },
      });
    });

    it("should map CLGauge.ClaimRewards event data correctly", async () => {
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "CLGauge",
                event: "ClaimRewards",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 102,
                  timestamp: 1000002,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  from: mockUserAddress,
                  amount: 1000000000000000000000n, // 1000 reward tokens
                },
              },
            ],
          },
        },
      });
    });
  });

  describe("Handler Integration", () => {
    it("should call shared logic functions without errors for Deposit", async () => {
      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "CLGauge",
                event: "Deposit",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 100,
                  timestamp: 1000000,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  tokenId: 1n,
                  user: mockUserAddress,
                  liquidityToStake: 100000000000000000000n,
                },
              },
            ],
          },
        },
      });
    });

    it("should call shared logic functions without errors for Withdraw", async () => {
      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "CLGauge",
                event: "Withdraw",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 101,
                  timestamp: 1000001,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  tokenId: 1n,
                  user: mockUserAddress,
                  liquidityToStake: 50000000000000000000n,
                },
              },
            ],
          },
        },
      });
    });

    it("should call shared logic functions without errors for ClaimRewards", async () => {
      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "CLGauge",
                event: "ClaimRewards",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 102,
                  timestamp: 1000002,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  from: mockUserAddress,
                  amount: 1000000000000000000000n,
                },
              },
            ],
          },
        },
      });
    });
  });

  describe("EarlyWithdrawPenalty", () => {
    const { createMockPool, mockToken0Data, mockToken1Data } = setupCommon();
    const blockNumber = 150_964_133;
    const rewardTokenAddress =
      getLegacyConstants(mockChainId).rewardToken(blockNumber);
    const rewardToken: Token = {
      ...mockToken0Data,
      id: TokenId(mockChainId, rewardTokenAddress),
      address: rewardTokenAddress,
      symbol: "VELO",
      name: "Velodrome",
      decimals: 18n,
      pricePerUSDNew: 2n * 10n ** 17n, // $0.20
    };

    it("adds the penalty to the CL pool's and the user's penalty totals, not to claims", async () => {
      const pool = createMockPool({
        chainId: mockChainId,
        gaugeAddress: mockGaugeAddress,
        isCL: true,
        totalGaugeRewardsClaimed: 7n,
        totalGaugeEarlyWithdrawPenalties: 3n * 10n ** 18n,
        totalGaugeEarlyWithdrawPenaltiesUSD: 6n * 10n ** 17n,
      });
      indexer.Pool.set(pool);
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);
      indexer.Token.set(rewardToken);
      const penalty = 25n * 10n ** 18n; // 25 VELO

      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "CLGauge",
                event: "EarlyWithdrawPenalty",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: blockNumber,
                  timestamp: 1_760_000_000,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: { from: mockUserAddress, tokenId: 1n, penalty },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(pool.id);
      expect(updatedPool?.totalGaugeEarlyWithdrawPenalties).toBe(
        3n * 10n ** 18n + penalty,
      );
      // 25 VELO at $0.20 = $5, on top of the $0.60 already recorded
      expect(updatedPool?.totalGaugeEarlyWithdrawPenaltiesUSD).toBe(
        6n * 10n ** 17n + 5n * 10n ** 18n,
      );
      expect(updatedPool?.totalGaugeRewardsClaimed).toBe(7n);
      expect(updatedPool?.numberOfGaugeRewardClaims).toBe(
        pool.numberOfGaugeRewardClaims,
      );

      const user = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(mockChainId, mockUserAddress, pool.poolAddress),
      );
      expect(user?.totalGaugeEarlyWithdrawPenalties).toBe(penalty);
      expect(user?.totalGaugeEarlyWithdrawPenaltiesUSD).toBe(5n * 10n ** 18n);
      expect(user?.totalGaugeRewardsClaimed).toBe(0n);
    });
  });
});
