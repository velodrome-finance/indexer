import type { LiquidityPoolAggregator, Token } from "generated";
import {
  MockDb,
  RootCLPoolFactory,
  Voter,
} from "generated/src/TestHelpers.gen";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  CHAIN_CONSTANTS,
  PendingDistributionId,
  PoolId,
  RootGaugeRootPoolId,
  RootPoolLeafPoolId,
  TokenId,
  toChecksumAddress,
} from "../../../src/Constants";
import { getTokensDeposited } from "../../../src/Effects/Voter";
import { setupCommon } from "../Pool/common";

// --- DistributeReward test helpers ---
interface EffectWithHandler<I, O> {
  name: string;
  handler: (args: { input: I; context: unknown }) => Promise<O>;
}

const DEFAULT_REWARD_TIMESTAMP_SECONDS = 1000000;

function createRewardToken(
  chainId: number,
  rewardTokenAddress: string,
  overrides?: Partial<Token> & { timestampSeconds?: number },
): Token {
  const timestampSeconds =
    overrides?.timestampSeconds ?? DEFAULT_REWARD_TIMESTAMP_SECONDS;
  const base: Token = {
    id: TokenId(chainId, rewardTokenAddress),
    address: rewardTokenAddress as `0x${string}`,
    symbol: "VELO",
    name: "VELO",
    chainId,
    decimals: 18n,
    pricePerUSDNew: 2n * 10n ** 18n,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(timestampSeconds * 1000),
  } as Token;
  if (!overrides) return base;
  const { timestampSeconds: _ts, ...rest } = overrides;
  return { ...base, ...rest };
}

function setupDistributeRewardMocks(
  chainId: number,
  rewardTokenAddress: string,
  options?: { getTokensDepositedValue?: bigint; timestampSeconds?: number },
): { rewardToken: Token; cleanup: () => void } {
  const original = CHAIN_CONSTANTS[chainId];
  CHAIN_CONSTANTS[chainId] = {
    ...original,
    rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
  };

  let spy: ReturnType<typeof vi.spyOn> | undefined;
  if (options?.getTokensDepositedValue !== undefined) {
    spy = vi
      .spyOn(
        getTokensDeposited as unknown as EffectWithHandler<
          {
            rewardTokenAddress: string;
            gaugeAddress: string;
            blockNumber: number;
            eventChainId: number;
          },
          bigint | undefined
        >,
        "handler",
      )
      .mockImplementation(async () => options.getTokensDepositedValue);
  }

  const rewardToken = createRewardToken(chainId, rewardTokenAddress, {
    timestampSeconds: options?.timestampSeconds,
  });

  const cleanup = () => {
    CHAIN_CONSTANTS[chainId] = original;
    spy?.mockRestore();
  };

  return { rewardToken, cleanup };
}
// --- end DistributeReward helpers ---
describe("Voter Events", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GaugeCreated Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeCreated.createMockEvent>;
    const chainId = 10;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.GaugeCreated.createMockEvent({
        poolFactory: toChecksumAddress(
          "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
        ), // VAMM factory
        votingRewardsFactory: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        gaugeFactory: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        pool: poolAddress,
        bribeVotingReward: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        feeVotingReward: toChecksumAddress(
          "0x6666666666666666666666666666666666666666",
        ),
        gauge: gaugeAddress,
        creator: toChecksumAddress(
          "0x7777777777777777777777777777777777777777",
        ),
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool entity exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        } as LiquidityPoolAggregator;

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await mockDb.processEvents([mockEvent]);
      });

      it("should update pool entity with gauge address and voting reward addresses", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          toChecksumAddress("0x6666666666666666666666666666666666666666"),
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          toChecksumAddress("0x5555555555555555555555555555555555555555"),
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist (RootPool case)", () => {
      it("should create RootGauge_RootPool for cross-chain DistributeReward resolution", async () => {
        const resultDB = await mockDb.processEvents([mockEvent]);

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);

        const expectedId = RootGaugeRootPoolId(chainId, gaugeAddress);
        const rootGaugeRootPool =
          resultDB.entities.RootGauge_RootPool.get(expectedId);
        expect(rootGaugeRootPool).toBeDefined();
        expect(rootGaugeRootPool?.rootChainId).toBe(chainId);
        expect(rootGaugeRootPool?.rootGaugeAddress).toBe(gaugeAddress);
        expect(rootGaugeRootPool?.rootPoolAddress).toBe(poolAddress);
      });
    });

    describe("when pool factory is CL factory", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      let clFactoryEvent: ReturnType<typeof Voter.GaugeCreated.createMockEvent>;

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        } as LiquidityPoolAggregator;

        // Create event with CL factory address (from CLPOOLS_FACTORY_LIST)
        clFactoryEvent = Voter.GaugeCreated.createMockEvent({
          poolFactory: toChecksumAddress(
            "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F",
          ), // CL factory (optimism)
          votingRewardsFactory: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          gaugeFactory: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ),
          pool: poolAddress,
          bribeVotingReward: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ),
          feeVotingReward: toChecksumAddress(
            "0x6666666666666666666666666666666666666666",
          ),
          gauge: gaugeAddress,
          creator: toChecksumAddress(
            "0x7777777777777777777777777777777777777777",
          ),
          mockEventData: {
            block: {
              number: 123456,
              timestamp: 1000000,
              hash: "0xhash",
            },
            chainId: chainId,
            logIndex: 1,
          },
        });

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await mockDb.processEvents([clFactoryEvent]);
      });

      it("should update pool entity with gauge address (CL factory path)", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          toChecksumAddress("0x6666666666666666666666666666666666666666"),
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          toChecksumAddress("0x5555555555555555555555555555555555555555"),
        );
      });
    });
  });

  describe("GaugeKilled Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeKilled.createMockEvent>;
    const chainId = 10;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.GaugeKilled.createMockEvent({
        gauge: gaugeAddress,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool entity exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Initially has gauge address
          gaugeIsAlive: true, // Initially alive
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        } as LiquidityPoolAggregator;

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await mockDb.processEvents([mockEvent]);
      });

      it("should set gaugeIsAlive to false but preserve gauge address and voting reward addresses as historical data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
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
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        // Mock findPoolByGaugeAddress to return null
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        const resultDB = await mockDb.processEvents([mockEvent]);

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });
  });

  describe("GaugeRevived Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeRevived.createMockEvent>;
    const chainId = 10;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.GaugeRevived.createMockEvent({
        gauge: gaugeAddress,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool entity exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Has gauge address
          gaugeIsAlive: false, // Initially killed
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        } as LiquidityPoolAggregator;

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await mockDb.processEvents([mockEvent]);
      });

      it("should set gaugeIsAlive to true", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(true); // Should be set to true
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        // Mock findPoolByGaugeAddress to return null
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        const resultDB = await mockDb.processEvents([mockEvent]);

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });
  });

  describe("DistributeReward Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.DistributeReward.createMockEvent>;

    /**
     * Constants for the Distribute Reward event test. Note that we can use real
     * poolAddress and gaugeAddresses to make the call work.
     *
     * @constant {number} chainId - The chain ID for Optimism.
     * @constant {string} poolAddress - The address of the liquidity pool.
     * @constant {string} gaugeAddress - The address of the gauge.
     *
     * @see {@link ../../.cache/guagetopool-10.json} for a mapping between gauge and pool that exists.
     */
    const chainId = 10; // Optimism
    const voterAddress = toChecksumAddress(
      "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
    );
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const poolId = PoolId(chainId, poolAddress);
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );
    const blockNumber = 128357873;

    const rewardTokenAddress =
      CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

    beforeEach(() => {
      mockDb = MockDb.createMockDb();

      // Setup the mock event
      mockEvent = Voter.DistributeReward.createMockEvent({
        gauge: gaugeAddress,
        amount: 1000n * 10n ** 18n, // 1000 tokens with 18 decimals
        mockEventData: {
          block: {
            number: blockNumber,
            timestamp: 1000000,
            hash: "0xblockhash",
          },
          chainId: chainId,
          logIndex: 0,
          srcAddress: voterAddress,
        },
      });
    });

    describe("when reward token and liquidity pool exist", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let updatedDB: ReturnType<typeof MockDb.createMockDb>;
      let cleanup: () => void;

      const { mockLiquidityPoolData } = setupCommon();

      let expectations: {
        totalEmissions: bigint;
        totalEmissionsUSD: bigint;
        getTokensDeposited: bigint;
        getTokensDepositedUSD: bigint;
      };

      beforeEach(async () => {
        const liquidityPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          totalEmissions: 0n,
          totalEmissionsUSD: 0n,
          totalVotesDeposited: 0n,
          totalVotesDepositedUSD: 0n,
          gaugeIsAlive: false, // DistributeReward does not set this; we assert it remains unchanged
        } as LiquidityPoolAggregator;

        expectations = {
          totalEmissions: 1000n * 10n ** 18n, // normalizedEmissionsAmount
          totalEmissionsUSD: 2000n * 10n ** 18n, // normalizedEmissionsAmountUsd
          getTokensDeposited: 500n * 10n ** 18n,
          getTokensDepositedUSD: 1000n * 10n ** 18n,
        };

        const { rewardToken, cleanup: cleanupFn } = setupDistributeRewardMocks(
          chainId,
          rewardTokenAddress,
          { getTokensDepositedValue: expectations.getTokensDeposited },
        );
        cleanup = cleanupFn;

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(liquidityPool);

        // Set entities in the mock database
        updatedDB = mockDb.entities.Token.set(rewardToken);
        updatedDB =
          updatedDB.entities.LiquidityPoolAggregator.set(liquidityPool);

        // Process the event
        resultDB = await updatedDB.processEvents([mockEvent]);
      });

      afterEach(() => {
        cleanup();
      });

      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should update the liquidity pool aggregator with emissions data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalEmissions).toBe(expectations.totalEmissions);
        expect(updatedPool?.totalEmissionsUSD).toBe(
          expectations.totalEmissionsUSD,
        );
        expect(updatedPool?.totalVotesDeposited).toBe(
          expectations.getTokensDeposited,
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should update the liquidity pool aggregator with votes deposited data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalVotesDeposited).toBe(
          expectations.getTokensDeposited,
        );
        expect(updatedPool?.totalVotesDepositedUSD).toBe(
          expectations.getTokensDepositedUSD,
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
      });
      it("should not modify gaugeIsAlive (preserves existing value) when false", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(false);
      });

      describe("when pool has gaugeIsAlive true", () => {
        let resultDBWithAliveGauge: ReturnType<typeof MockDb.createMockDb>;
        let originalChainConstantsAlive: (typeof CHAIN_CONSTANTS)[typeof chainId];

        beforeEach(async () => {
          const liquidityPool: LiquidityPoolAggregator = {
            ...mockLiquidityPoolData,
            id: PoolId(chainId, poolAddress),
            chainId: chainId,
            totalEmissions: 0n,
            totalEmissionsUSD: 0n,
            totalVotesDeposited: 0n,
            totalVotesDepositedUSD: 0n,
            gaugeIsAlive: true,
          } as LiquidityPoolAggregator;

          const rewardToken: Token = {
            id: TokenId(chainId, rewardTokenAddress),
            address: rewardTokenAddress,
            symbol: "VELO",
            name: "VELO",
            chainId: chainId,
            decimals: 18n,
            pricePerUSDNew: 2n * 10n ** 18n,
            isWhitelisted: true,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          } as Token;

          vi.spyOn(
            LiquidityPoolAggregatorModule,
            "findPoolByGaugeAddress",
          ).mockResolvedValue(liquidityPool);

          vi.spyOn(
            getTokensDeposited as unknown as EffectWithHandler<
              {
                rewardTokenAddress: string;
                gaugeAddress: string;
                blockNumber: number;
                eventChainId: number;
              },
              bigint | undefined
            >,
            "handler",
          ).mockImplementation(async () => 500n * 10n ** 18n);

          originalChainConstantsAlive = CHAIN_CONSTANTS[chainId];
          CHAIN_CONSTANTS[chainId] = {
            ...originalChainConstantsAlive,
            rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
          };

          let db = mockDb.entities.Token.set(rewardToken);
          db = db.entities.LiquidityPoolAggregator.set(liquidityPool);
          resultDBWithAliveGauge = await db.processEvents([mockEvent]);
        });

        afterEach(() => {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsAlive;
        });

        it("should not modify gaugeIsAlive (preserves existing value) when true", () => {
          const updatedPool =
            resultDBWithAliveGauge.entities.LiquidityPoolAggregator.get(poolId);
          expect(updatedPool).toBeDefined();
          expect(updatedPool?.gaugeIsAlive).toBe(true);
        });
      });
    });

    describe("when pool entity does not exist", () => {
      let originalChainConstantsForPoolTest: (typeof CHAIN_CONSTANTS)[typeof chainId];

      it("should return early when pool does not exist and no RootGauge_RootPool mapping", async () => {
        // Mock CHAIN_CONSTANTS rewardToken function
        originalChainConstantsForPoolTest = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsForPoolTest,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        // Mock findPoolByGaugeAddress to return null (root gauge, no local pool)
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        const resultDB = await mockDb.processEvents([mockEvent]);

        // Should not create any pool entities when pool doesn't exist and no root-gauge mapping
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });

      afterEach(() => {
        // Restore original CHAIN_CONSTANTS to prevent test pollution
        if (originalChainConstantsForPoolTest !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsForPoolTest;
        }
      });
    });

    describe("when root gauge and no RootPool_LeafPool (deferred)", () => {
      const rootPoolAddress = poolAddress;
      const leafChainId = 252;
      const blockTimestamp = 1000000;
      const blockNumberForRoot = 128357870;
      const txHash =
        "0x1234567890123456789012345678901234567890123456789012345678901234";
      const token0 = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const token1 = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const tickSpacing = 60n;
      let originalChainConstantsDeferred: (typeof CHAIN_CONSTANTS)[typeof chainId];

      it("should create RootGauge_RootPool and PendingDistribution when processEvents RootPoolCreated, GaugeCreated, DistributeReward with no leaf", async () => {
        originalChainConstantsDeferred = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsDeferred,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        vi.spyOn(
          getTokensDeposited as unknown as EffectWithHandler<
            {
              rewardTokenAddress: string;
              gaugeAddress: string;
              blockNumber: number;
              eventChainId: number;
            },
            bigint | undefined
          >,
          "handler",
        ).mockImplementation(async () => 500n * 10n ** 18n);

        const rewardToken: Token = {
          id: TokenId(chainId, rewardTokenAddress),
          address: rewardTokenAddress,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n,
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
        } as Token;

        let db = MockDb.createMockDb();
        db = db.entities.Token.set(rewardToken);

        const rootPoolCreatedEvent =
          RootCLPoolFactory.RootPoolCreated.createMockEvent({
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress,
            mockEventData: {
              block: {
                timestamp: blockTimestamp,
                number: blockNumberForRoot,
                hash: txHash,
              },
              chainId: chainId,
              logIndex: 1,
            },
          });
        const gaugeCreatedEvent = Voter.GaugeCreated.createMockEvent({
          poolFactory: toChecksumAddress(
            "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F",
          ),
          votingRewardsFactory: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          gaugeFactory: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ),
          pool: rootPoolAddress,
          bribeVotingReward: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ),
          feeVotingReward: toChecksumAddress(
            "0x6666666666666666666666666666666666666666",
          ),
          gauge: gaugeAddress,
          creator: toChecksumAddress(
            "0x7777777777777777777777777777777777777777",
          ),
          mockEventData: {
            block: {
              number: blockNumberForRoot,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId: chainId,
            logIndex: 2,
          },
        });
        const distributeRewardEvent = Voter.DistributeReward.createMockEvent({
          gauge: gaugeAddress,
          amount: 1000n * 10n ** 18n,
          mockEventData: {
            block: {
              number: blockNumberForRoot,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId: chainId,
            logIndex: 3,
            srcAddress: toChecksumAddress(
              "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
            ),
          },
        });

        const resultDB = await db.processEvents([
          rootPoolCreatedEvent,
          gaugeCreatedEvent,
          distributeRewardEvent,
        ]);

        expect(
          resultDB.entities.RootGauge_RootPool.get(
            RootGaugeRootPoolId(chainId, gaugeAddress),
          ),
        ).toBeDefined();

        const pendingDistId = PendingDistributionId(
          chainId,
          rootPoolAddress,
          blockNumberForRoot,
          3,
        );
        const pendingDistribution =
          resultDB.entities.PendingDistribution.get(pendingDistId);
        expect(pendingDistribution).toBeDefined();
        expect(pendingDistribution?.gaugeAddress).toBe(gaugeAddress);
        expect(pendingDistribution?.amount).toBe(1000n * 10n ** 18n);

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });

      afterEach(() => {
        if (originalChainConstantsDeferred !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsDeferred;
        }
      });

      it("should create PendingDistribution when root gauge has ambiguous RootPool_LeafPool mapping (length > 1)", async () => {
        originalChainConstantsDeferred = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsDeferred,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        const rootPoolAddressForAmbiguous = poolAddress;
        const leafChainId = 252;
        const leafPoolAddressA = toChecksumAddress(
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        const leafPoolAddressB = toChecksumAddress(
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        );
        const blockNumberForRoot = 128357870;
        const logIndex = 3;

        const rewardToken: Token = {
          id: TokenId(chainId, rewardTokenAddress),
          address: rewardTokenAddress,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n,
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } as Token;

        const rootGaugeRootPoolId = RootGaugeRootPoolId(chainId, gaugeAddress);
        const rootPoolLeafPoolIdA = RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddressForAmbiguous,
          leafPoolAddressA,
        );
        const rootPoolLeafPoolIdB = RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddressForAmbiguous,
          leafPoolAddressB,
        );

        const distributeRewardEvent = Voter.DistributeReward.createMockEvent({
          gauge: gaugeAddress,
          amount: 1000n * 10n ** 18n,
          mockEventData: {
            block: {
              number: blockNumberForRoot,
              timestamp: 1000000,
              hash: "0xblockhash",
            },
            chainId: chainId,
            logIndex,
            srcAddress: toChecksumAddress(
              "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
            ),
          },
        });

        let db = MockDb.createMockDb();
        db = db.entities.Token.set(rewardToken);
        db = db.entities.RootGauge_RootPool.set({
          id: rootGaugeRootPoolId,
          rootChainId: chainId,
          rootGaugeAddress: gaugeAddress,
          rootPoolAddress: rootPoolAddressForAmbiguous,
        });
        db = db.entities.RootPool_LeafPool.set({
          id: rootPoolLeafPoolIdA,
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddressForAmbiguous,
          leafChainId,
          leafPoolAddress: leafPoolAddressA,
        });
        db = db.entities.RootPool_LeafPool.set({
          id: rootPoolLeafPoolIdB,
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddressForAmbiguous,
          leafChainId,
          leafPoolAddress: leafPoolAddressB,
        });

        const resultDB = await db.processEvents([distributeRewardEvent]);

        const pendingDistId = PendingDistributionId(
          chainId,
          rootPoolAddressForAmbiguous,
          blockNumberForRoot,
          logIndex,
        );
        const pendingDistribution =
          resultDB.entities.PendingDistribution.get(pendingDistId);
        expect(pendingDistribution).toBeDefined();
        expect(pendingDistribution?.gaugeAddress).toBe(gaugeAddress);
        expect(pendingDistribution?.amount).toBe(1000n * 10n ** 18n);
        expect(pendingDistribution?.rootPoolAddress).toBe(
          rootPoolAddressForAmbiguous,
        );
        expect(pendingDistribution?.blockNumber).toBe(
          BigInt(blockNumberForRoot),
        );
        expect(pendingDistribution?.logIndex).toBe(logIndex);

        // Distribution was deferred; no pool should have been updated
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });

    describe("when gauge is root gauge and RootGauge_RootPool + RootPool_LeafPool exist", () => {
      const leafChainId = 252;
      const rootPoolAddress = poolAddress;
      const leafPoolAddress = toChecksumAddress(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      const leafPoolId = PoolId(leafChainId, leafPoolAddress);
      const leafGaugeAddress = toChecksumAddress(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
      let originalChainConstantsCrossChain: (typeof CHAIN_CONSTANTS)[typeof chainId];

      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should apply distribution to leaf pool without overwriting gaugeAddress", async () => {
        const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
          setupCommon();

        const leafToken0Id = TokenId(leafChainId, mockToken0Data.address);
        const leafToken1Id = TokenId(leafChainId, mockToken1Data.address);
        const leafPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: leafPoolId,
          poolAddress: leafPoolAddress as `0x${string}`,
          chainId: leafChainId,
          token0_id: leafToken0Id,
          token1_id: leafToken1Id,
          token0_address: mockToken0Data.address as `0x${string}`,
          token1_address: mockToken1Data.address as `0x${string}`,
          totalEmissions: 0n,
          totalEmissionsUSD: 0n,
          totalVotesDeposited: 0n,
          totalVotesDepositedUSD: 0n,
          gaugeAddress: leafGaugeAddress,
          gaugeIsAlive: true,
        } as LiquidityPoolAggregator;

        const rewardToken: Token = {
          id: TokenId(chainId, rewardTokenAddress),
          address: rewardTokenAddress,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n,
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } as Token;

        const leafToken0: Token = {
          ...mockToken0Data,
          id: leafToken0Id,
          chainId: leafChainId,
        };
        const leafToken1: Token = {
          ...mockToken1Data,
          id: leafToken1Id,
          chainId: leafChainId,
        };

        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        vi.spyOn(
          getTokensDeposited as unknown as EffectWithHandler<
            {
              rewardTokenAddress: string;
              gaugeAddress: string;
              blockNumber: number;
              eventChainId: number;
            },
            bigint | undefined
          >,
          "handler",
        ).mockImplementation(async () => 500n * 10n ** 18n);

        originalChainConstantsCrossChain = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsCrossChain,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        const rootGaugeRootPoolId = RootGaugeRootPoolId(chainId, gaugeAddress);
        const rootPoolLeafPoolId = RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
        );

        let db = mockDb.entities.Token.set(rewardToken);
        db = db.entities.Token.set(leafToken0);
        db = db.entities.Token.set(leafToken1);
        db = db.entities.LiquidityPoolAggregator.set(leafPool);
        db = db.entities.RootGauge_RootPool.set({
          id: rootGaugeRootPoolId,
          rootChainId: chainId,
          rootGaugeAddress: gaugeAddress,
          rootPoolAddress: rootPoolAddress,
        });
        db = db.entities.RootPool_LeafPool.set({
          id: rootPoolLeafPoolId,
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddress,
          leafChainId,
          leafPoolAddress,
        });

        const resultDB = await db.processEvents([mockEvent]);

        const updatedLeafPool =
          resultDB.entities.LiquidityPoolAggregator.get(leafPoolId);
        expect(updatedLeafPool).toBeDefined();
        expect(updatedLeafPool?.totalEmissions).toBe(1000n * 10n ** 18n);
        expect(updatedLeafPool?.totalEmissionsUSD).toBe(2000n * 10n ** 18n);
        expect(updatedLeafPool?.totalVotesDeposited).toBe(500n * 10n ** 18n);
        // Cross-chain path must not overwrite leaf pool's gauge
        expect(updatedLeafPool?.gaugeAddress).toBe(leafGaugeAddress);
      });

      afterEach(() => {
        if (originalChainConstantsCrossChain !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsCrossChain;
        }
      });
    });

    describe("when reward token or liquidity pool is missing", () => {
      let originalChainConstantsForRewardTest: (typeof CHAIN_CONSTANTS)[typeof chainId];

      it("should log warning and return early when reward token is missing", async () => {
        const { mockLiquidityPoolData } = setupCommon();
        const liquidityPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          totalEmissions: 0n, // Start with 0 to test that it remains unchanged
        } as LiquidityPoolAggregator;

        // Mock CHAIN_CONSTANTS rewardToken function
        originalChainConstantsForRewardTest = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsForRewardTest,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(liquidityPool);

        // Create a fresh database with only the liquidity pool, no reward token
        const freshDb = MockDb.createMockDb();
        const testDb =
          freshDb.entities.LiquidityPoolAggregator.set(liquidityPool);

        const resultDB = await testDb.processEvents([mockEvent]);

        // Should not update any entities when reward token is missing
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(1);
        const pool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(pool?.totalEmissions).toBe(0n); // Should remain unchanged
      });

      afterEach(() => {
        // Restore original CHAIN_CONSTANTS to prevent test pollution
        if (originalChainConstantsForRewardTest !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsForRewardTest;
        }
      });
    });
  });
});
