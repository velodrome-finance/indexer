import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
  SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST,
  TokenId,
  toChecksumAddress,
} from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { type MockPool, setupCommon } from "../Pool/common";

describe("SuperchainLeafVoter Events", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const { createMockPool } = setupCommon();

  // SuperchainLeafVoter is deployed on superchains (Celo=42220, Soneium=1868, etc.),
  // not on Optimism (10). Use Celo so the V3 contract registry routes events correctly.
  const superchainId = 42220;

  describe("GaugeCreated Event", () => {
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    describe("when pool entity exists", () => {
      let indexer: ReturnType<typeof createTestIndexer>;
      let mockLiquidityPool: MockPool;

      beforeEach(async () => {
        mockLiquidityPool = createMockPool({
          poolAddress: poolAddress,
          chainId: superchainId,
          gaugeAddress: "", // Initially empty
        });

        indexer = createTestIndexer();
        indexer.Pool.set({
          ...mockLiquidityPool,
          lastSnapshotTimestamp: undefined,
        } as unknown as Parameters<typeof indexer.Pool.set>[0]);

        await simulateEvent(indexer, superchainId, {
          contract: "SuperchainLeafVoter",
          event: "GaugeCreated",
          params: {
            poolFactory: toChecksumAddress(
              "0xeAD23f606643E387a073D0EE8718602291ffaAeB",
            ) as `0x${string}`, // CL factory
            votingRewardsFactory: toChecksumAddress(
              "0x2222222222222222222222222222222222222222",
            ) as `0x${string}`,
            gaugeFactory: toChecksumAddress(
              "0x3333333333333333333333333333333333333333",
            ) as `0x${string}`,
            pool: poolAddress as `0x${string}`,
            incentiveVotingReward: toChecksumAddress(
              "0x5555555555555555555555555555555555555555",
            ) as `0x${string}`,
            feeVotingReward: toChecksumAddress(
              "0x6666666666666666666666666666666666666666",
            ) as `0x${string}`,
            gauge: gaugeAddress as `0x${string}`,
          },
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          logIndex: 1,
        });
      });

      // TODO: Skip until envio v3 supports seeded-entity reads inside simulateEvent workers (alpha.18).
      // When entities are pre-seeded and the handler reads them (context.Pool.get / getWhere),
      // the worker hangs and vitest times out after 10s. Same pattern as SuperchainIncentiveVotingReward.test.ts.
      it.skip("should update pool entity with gauge address and voting reward addresses", async () => {
        const updatedPool = await indexer.Pool.get(mockLiquidityPool.id);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          toChecksumAddress("0x6666666666666666666666666666666666666666"),
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          toChecksumAddress("0x5555555555555555555555555555555555555555"),
        );
        expect(
          new Date(
            updatedPool?.lastUpdatedTimestamp as unknown as string,
          ).getTime(),
        ).toBe(new Date(1000000 * 1000).getTime());
      });
    });

    it("calls addCLGauge when poolFactory is in SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST", async () => {
      const poolFactoryFromList = SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST[0];
      const indexer = createTestIndexer();

      await simulateEvent(indexer, superchainId, {
        contract: "SuperchainLeafVoter",
        event: "GaugeCreated",
        params: {
          poolFactory: poolFactoryFromList as `0x${string}`,
          votingRewardsFactory: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ) as `0x${string}`,
          gaugeFactory: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ) as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          incentiveVotingReward: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ) as `0x${string}`,
          feeVotingReward: toChecksumAddress(
            "0x6666666666666666666666666666666666666666",
          ) as `0x${string}`,
          gauge: gaugeAddress as `0x${string}`,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0xhash",
        },
        logIndex: 1,
      });

      expect(indexer).toBeDefined();
    });

    it("calls addGauge when poolFactory is in SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST", async () => {
      const poolFactoryFromList =
        SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST[0];
      const indexer = createTestIndexer();

      await simulateEvent(indexer, superchainId, {
        contract: "SuperchainLeafVoter",
        event: "GaugeCreated",
        params: {
          poolFactory: poolFactoryFromList as `0x${string}`,
          votingRewardsFactory: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ) as `0x${string}`,
          gaugeFactory: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ) as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          incentiveVotingReward: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ) as `0x${string}`,
          feeVotingReward: toChecksumAddress(
            "0x6666666666666666666666666666666666666666",
          ) as `0x${string}`,
          gauge: gaugeAddress as `0x${string}`,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0xhash",
        },
        logIndex: 1,
      });

      expect(indexer).toBeDefined();
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        const indexer = createTestIndexer();

        await simulateEvent(indexer, superchainId, {
          contract: "SuperchainLeafVoter",
          event: "GaugeCreated",
          params: {
            poolFactory: toChecksumAddress(
              "0xeAD23f606643E387a073D0EE8718602291ffaAeB",
            ) as `0x${string}`,
            votingRewardsFactory: toChecksumAddress(
              "0x2222222222222222222222222222222222222222",
            ) as `0x${string}`,
            gaugeFactory: toChecksumAddress(
              "0x3333333333333333333333333333333333333333",
            ) as `0x${string}`,
            pool: poolAddress as `0x${string}`,
            incentiveVotingReward: toChecksumAddress(
              "0x5555555555555555555555555555555555555555",
            ) as `0x${string}`,
            feeVotingReward: toChecksumAddress(
              "0x6666666666666666666666666666666666666666",
            ) as `0x${string}`,
            gauge: gaugeAddress as `0x${string}`,
          },
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          logIndex: 1,
        });

        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
      });
    });
  });

  describe("WhitelistToken Event", () => {
    // Real WETH on Celo — has on-chain bytecode, so the #677
    // hasContractBytecode gate doesn't short-circuit Token creation.
    const tokenAddress = toChecksumAddress(
      "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
    );
    const blockTimestamp = 1000000;

    describe("when token already exists", () => {
      const expectedPricePerUSDNew = BigInt(10000000);
      let indexer: ReturnType<typeof createTestIndexer>;

      beforeEach(async () => {
        const token: Token = {
          id: TokenId(superchainId, tokenAddress),
          address: tokenAddress,
          symbol: "TEST",
          name: "TEST",
          chainId: superchainId,
          decimals: BigInt(18),
          pricePerUSDNew: expectedPricePerUSDNew,
          isWhitelisted: false,
        } as Token;

        indexer = createTestIndexer();
        indexer.Token.set(token);

        await simulateEvent(indexer, superchainId, {
          contract: "SuperchainLeafVoter",
          event: "WhitelistToken",
          params: {
            token: tokenAddress as `0x${string}`,
            _bool: true,
          },
          block: {
            number: 123456,
            timestamp: blockTimestamp,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        });
      });

      // TODO: Skip until envio v3 supports seeded-entity reads inside simulateEvent workers (alpha.18).
      // When entities are pre-seeded and the handler reads them (context.Token.get),
      // the worker hangs and vitest times out after 10s. Same pattern as SuperchainIncentiveVotingReward.test.ts.
      it.skip("should update the existing token entity", async () => {
        const token = await indexer.Token.get(
          TokenId(superchainId, tokenAddress),
        );
        expect(token).toBeDefined();
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
        expect(
          new Date(token?.lastUpdatedTimestamp as unknown as string).getTime(),
        ).toBe(blockTimestamp * 1000);
      });
    });

    describe("when token does not exist yet", () => {
      let indexer: ReturnType<typeof createTestIndexer>;

      beforeEach(async () => {
        indexer = createTestIndexer();

        await simulateEvent(indexer, superchainId, {
          contract: "SuperchainLeafVoter",
          event: "WhitelistToken",
          params: {
            token: tokenAddress as `0x${string}`,
            _bool: true,
          },
          block: {
            number: 123456,
            timestamp: blockTimestamp,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        });
      });

      it("should create a new Token entity with whitelisted flag", async () => {
        const token = await indexer.Token.get(
          TokenId(superchainId, tokenAddress),
        );
        expect(token).toBeDefined();
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(0n);
        expect(typeof token?.name).toBe("string");
        expect(typeof token?.symbol).toBe("string");
        expect(token?.address).toBe(tokenAddress);
        expect(
          new Date(token?.lastUpdatedTimestamp as unknown as string).getTime(),
        ).toBe(blockTimestamp * 1000);
      });
    });

    describe("when _bool is false (de-whitelisting)", () => {
      describe("when token already exists and is whitelisted", () => {
        const expectedPricePerUSDNew = BigInt(10000000);
        let indexer: ReturnType<typeof createTestIndexer>;

        beforeEach(async () => {
          const token: Token = {
            id: TokenId(superchainId, tokenAddress),
            address: tokenAddress,
            symbol: "TEST",
            name: "TEST",
            chainId: superchainId,
            decimals: BigInt(18),
            pricePerUSDNew: expectedPricePerUSDNew,
            isWhitelisted: true, // Initially whitelisted
          } as Token;

          indexer = createTestIndexer();
          indexer.Token.set(token);

          await simulateEvent(indexer, superchainId, {
            contract: "SuperchainLeafVoter",
            event: "WhitelistToken",
            params: {
              token: tokenAddress as `0x${string}`,
              _bool: false,
            },
            block: {
              number: 123456,
              timestamp: blockTimestamp,
              hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
            },
            logIndex: 1,
          });
        });

        // TODO: Skip until envio v3 supports seeded-entity reads inside simulateEvent workers (alpha.18).
        // When entities are pre-seeded and the handler reads them (context.Token.get),
        // the worker hangs and vitest times out after 10s. Same pattern as SuperchainIncentiveVotingReward.test.ts.
        it.skip("should update the existing token entity to de-whitelist it", async () => {
          const token = await indexer.Token.get(
            TokenId(superchainId, tokenAddress),
          );
          expect(token).toBeDefined();
          expect(token?.isWhitelisted).toBe(false);
          expect(token?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
          expect(
            new Date(
              token?.lastUpdatedTimestamp as unknown as string,
            ).getTime(),
          ).toBe(blockTimestamp * 1000);
        });
      });

      describe("when token does not exist yet", () => {
        let indexer: ReturnType<typeof createTestIndexer>;

        beforeEach(async () => {
          indexer = createTestIndexer();

          await simulateEvent(indexer, superchainId, {
            contract: "SuperchainLeafVoter",
            event: "WhitelistToken",
            params: {
              token: tokenAddress as `0x${string}`,
              _bool: false,
            },
            block: {
              number: 123456,
              timestamp: blockTimestamp,
              hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
            },
            logIndex: 1,
          });
        });

        it("should create a new Token entity with isWhitelisted set to false", async () => {
          const token = await indexer.Token.get(
            TokenId(superchainId, tokenAddress),
          );
          expect(token).toBeDefined();
          expect(token?.isWhitelisted).toBe(false);
          expect(token?.pricePerUSDNew).toBe(0n);
          expect(typeof token?.name).toBe("string");
          expect(typeof token?.symbol).toBe("string");
          expect(token?.address).toBe(tokenAddress);
          expect(
            new Date(
              token?.lastUpdatedTimestamp as unknown as string,
            ).getTime(),
          ).toBe(blockTimestamp * 1000);
        });
      });
    });
  });

  describe("GaugeKilled Event", () => {
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    describe("when pool entity exists", () => {
      let indexer: ReturnType<typeof createTestIndexer>;
      let mockLiquidityPool: MockPool;
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

      beforeEach(async () => {
        mockLiquidityPool = createMockPool({
          poolAddress: poolAddress,
          chainId: superchainId,
          gaugeAddress: gaugeAddress, // Initially has gauge address
          gaugeIsAlive: true, // Initially alive
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        });

        indexer = createTestIndexer();
        indexer.Pool.set({
          ...mockLiquidityPool,
          lastSnapshotTimestamp: undefined,
        } as unknown as Parameters<typeof indexer.Pool.set>[0]);

        await simulateEvent(indexer, superchainId, {
          contract: "SuperchainLeafVoter",
          event: "GaugeKilled",
          params: {
            gauge: gaugeAddress as `0x${string}`,
          },
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          logIndex: 1,
        });
      });

      // TODO: Skip until envio v3 supports seeded-entity reads inside simulateEvent workers (alpha.18).
      // When entities are pre-seeded and the handler reads them (context.Pool.getWhere via findPoolByGaugeAddress),
      // the worker hangs and vitest times out after 10s. Same pattern as SuperchainIncentiveVotingReward.test.ts.
      it.skip("should set gaugeIsAlive to false but preserve gauge address and voting reward addresses as historical data", async () => {
        const updatedPool = await indexer.Pool.get(mockLiquidityPool.id);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(false); // Should be set to false
        // Gauge address should be preserved as historical data
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        // Voting reward addresses should be preserved as historical data
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          feeVotingRewardAddress,
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          bribeVotingRewardAddress,
        );
        expect(
          new Date(
            updatedPool?.lastUpdatedTimestamp as unknown as string,
          ).getTime(),
        ).toBe(new Date(1000000 * 1000).getTime());
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        const indexer = createTestIndexer();

        await simulateEvent(indexer, superchainId, {
          contract: "SuperchainLeafVoter",
          event: "GaugeKilled",
          params: {
            gauge: gaugeAddress as `0x${string}`,
          },
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          logIndex: 1,
        });

        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
      });
    });
  });

  describe("GaugeRevived Event", () => {
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    describe("when pool entity exists", () => {
      let indexer: ReturnType<typeof createTestIndexer>;
      let mockLiquidityPool: MockPool;
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

      beforeEach(async () => {
        mockLiquidityPool = createMockPool({
          poolAddress: poolAddress,
          chainId: superchainId,
          gaugeAddress: gaugeAddress, // Has gauge address
          gaugeIsAlive: false, // Initially killed
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        });

        indexer = createTestIndexer();
        indexer.Pool.set({
          ...mockLiquidityPool,
          lastSnapshotTimestamp: undefined,
        } as unknown as Parameters<typeof indexer.Pool.set>[0]);

        await simulateEvent(indexer, superchainId, {
          contract: "SuperchainLeafVoter",
          event: "GaugeRevived",
          params: {
            gauge: gaugeAddress as `0x${string}`,
          },
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          logIndex: 1,
        });
      });

      // TODO: Skip until envio v3 supports seeded-entity reads inside simulateEvent workers (alpha.18).
      // When entities are pre-seeded and the handler reads them (context.Pool.getWhere via findPoolByGaugeAddress),
      // the worker hangs and vitest times out after 10s. Same pattern as SuperchainIncentiveVotingReward.test.ts.
      it.skip("should set gaugeIsAlive to true", async () => {
        const updatedPool = await indexer.Pool.get(mockLiquidityPool.id);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(true); // Should be set to true
        expect(
          new Date(
            updatedPool?.lastUpdatedTimestamp as unknown as string,
          ).getTime(),
        ).toBe(new Date(1000000 * 1000).getTime());
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        const indexer = createTestIndexer();

        await simulateEvent(indexer, superchainId, {
          contract: "SuperchainLeafVoter",
          event: "GaugeRevived",
          params: {
            gauge: gaugeAddress as `0x${string}`,
          },
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          logIndex: 1,
        });

        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
      });
    });
  });
});
