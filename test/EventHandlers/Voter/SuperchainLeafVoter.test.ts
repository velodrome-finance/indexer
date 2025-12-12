import { expect } from "chai";
import { MockDb, SuperchainLeafVoter } from "generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
} from "generated/src/Types.gen";
import sinon from "sinon";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  CHAIN_CONSTANTS,
  TokenIdByChain,
  toChecksumAddress,
} from "../../../src/Constants";
import { getIsAlive, getTokensDeposited } from "../../../src/Effects/Voter";
import { setupCommon } from "../Pool/common";

// Type interface for Effect with handler property (for testing purposes)
interface EffectWithHandler<I, O> {
  name: string;
  handler: (args: { input: I; context: unknown }) => Promise<O>;
}

describe("SuperchainLeafVoter Events", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("Voted Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof SuperchainLeafVoter.Voted.createMockEvent>;
    const chainId = 10; // Optimism
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const senderAddress = "0x1111111111111111111111111111111111111111";

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = SuperchainLeafVoter.Voted.createMockEvent({
        sender: senderAddress,
        pool: poolAddress,
        tokenId: 1n,
        weight: 100n,
        totalWeight: 1000n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool data exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      let mockUserStats: UserStatsPerPool;

      beforeEach(async () => {
        const {
          mockLiquidityPoolData,
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
        } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
        } as LiquidityPoolAggregator;

        mockUserStats = createMockUserStatsPerPool({
          userAddress: senderAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });

        // Setup mock database with required entities
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);
        mockDb = mockDb.entities.UserStatsPerPool.set(mockUserStats);
        mockDb = mockDb.entities.Token.set(mockToken0Data);
        mockDb = mockDb.entities.Token.set(mockToken1Data);

        resultDB = await SuperchainLeafVoter.Voted.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update liquidity pool aggregator with voting data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          toChecksumAddress(poolAddress),
        );
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.numberOfVotes).to.equal(1n);
        expect(updatedPool?.currentVotingPower).to.equal(1000n); // totalPoolVotingPower
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });

      it("should update user stats per pool with voting data", () => {
        const userStatsId = `${toChecksumAddress(senderAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
        const updatedUserStats =
          resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(updatedUserStats).to.not.be.undefined;
        expect(updatedUserStats?.numberOfVotes).to.equal(1n);
        expect(updatedUserStats?.currentVotingPower).to.equal(100n); // userVotingPowerToPool
        expect(updatedUserStats?.lastActivityTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating entities", async () => {
        const resultDB = await SuperchainLeafVoter.Voted.processEvent({
          event: mockEvent,
          mockDb,
        });

        // Should not create any new entities
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()).length,
        ).to.equal(0);
        expect(
          Array.from(resultDB.entities.UserStatsPerPool.getAll()).length,
        ).to.equal(0);
      });
    });
  });

  describe("GaugeCreated Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<
      typeof SuperchainLeafVoter.GaugeCreated.createMockEvent
    >;
    const chainId = 10;
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = SuperchainLeafVoter.GaugeCreated.createMockEvent({
        poolFactory: "0xeAD23f606643E387a073D0EE8718602291ffaAeB", // CL factory
        votingRewardsFactory: "0x2222222222222222222222222222222222222222",
        gaugeFactory: "0x3333333333333333333333333333333333333333",
        pool: poolAddress,
        incentiveVotingReward: "0x5555555555555555555555555555555555555555",
        feeVotingReward: "0x6666666666666666666666666666666666666666",
        gauge: gaugeAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
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
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        } as LiquidityPoolAggregator;

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await SuperchainLeafVoter.GaugeCreated.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update pool entity with gauge address and voting reward addresses", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          toChecksumAddress(poolAddress),
        );
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.gaugeAddress).to.equal(
          toChecksumAddress(gaugeAddress),
        );
        expect(updatedPool?.feeVotingRewardAddress).to.equal(
          "0x6666666666666666666666666666666666666666",
        );
        expect(updatedPool?.bribeVotingRewardAddress).to.equal(
          "0x5555555555555555555555555555555555555555",
        );
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        const resultDB = await SuperchainLeafVoter.GaugeCreated.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()).length,
        ).to.equal(0);
      });
    });
  });

  describe("DistributeReward Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<
      typeof SuperchainLeafVoter.DistributeReward.createMockEvent
    >;
    const chainId = 10; // Optimism
    const voterAddress = "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C";
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";
    const blockNumber = 128357873;

    const rewardTokenAddress =
      CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

    beforeEach(() => {
      mockDb = MockDb.createMockDb();

      mockEvent = SuperchainLeafVoter.DistributeReward.createMockEvent({
        gauge: gaugeAddress,
        amount: 1000n * 10n ** 18n,
        mockEventData: {
          block: {
            number: blockNumber,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId,
          logIndex: 1,
          srcAddress: voterAddress,
        },
      });
    });

    describe("when reward token and liquidity pool exist", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let updatedDB: ReturnType<typeof MockDb.createMockDb>;
      let originalGetIsAlive: unknown;
      let originalGetTokensDeposited: unknown;

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
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
          totalEmissions: 0n,
          totalEmissionsUSD: 0n,
          totalVotesDeposited: 0n,
          totalVotesDepositedUSD: 0n,
        } as LiquidityPoolAggregator;

        const rewardToken: Token = {
          id: TokenIdByChain(rewardTokenAddress, chainId),
          address: rewardTokenAddress,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n, // $2 per token
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(1000000 * 1000), // Set timestamp to prevent refresh
        } as Token;

        expectations = {
          totalEmissions: 1000n * 10n ** 18n, // normalizedEmissionsAmount
          totalEmissionsUSD: 2000n * 10n ** 18n, // normalizedEmissionsAmountUsd
          getTokensDeposited: 500n * 10n ** 18n,
          getTokensDepositedUSD: 1000n * 10n ** 18n,
        };

        // Mock findPoolByGaugeAddress to return the pool
        sandbox
          .stub(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .resolves(liquidityPool);

        // Mock the effect functions at module level
        originalGetIsAlive = getIsAlive;
        originalGetTokensDeposited = getTokensDeposited;

        sandbox
          .stub(
            getIsAlive as unknown as EffectWithHandler<
              {
                voterAddress: string;
                gaugeAddress: string;
                blockNumber: number;
                eventChainId: number;
              },
              boolean
            >,
            "handler",
          )
          .callsFake(async () => true);
        sandbox
          .stub(
            getTokensDeposited as unknown as EffectWithHandler<
              {
                rewardTokenAddress: string;
                gaugeAddress: string;
                blockNumber: number;
                eventChainId: number;
              },
              bigint
            >,
            "handler",
          )
          .callsFake(async () => expectations.getTokensDeposited);

        // Set entities in the mock database
        updatedDB = mockDb.entities.Token.set(rewardToken);
        updatedDB =
          updatedDB.entities.LiquidityPoolAggregator.set(liquidityPool);

        // Mock CHAIN_CONSTANTS rewardToken function
        const originalChainConstants = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstants,
          rewardToken: sandbox.stub().returns(rewardTokenAddress),
        };

        // Process the event
        resultDB = await SuperchainLeafVoter.DistributeReward.processEvent({
          event: mockEvent,
          mockDb: updatedDB,
        });
      });

      afterEach(() => {
        // Restore original functions
        (
          getIsAlive as unknown as EffectWithHandler<
            {
              voterAddress: string;
              gaugeAddress: string;
              blockNumber: number;
              eventChainId: number;
            },
            boolean
          >
        ).handler = (
          originalGetIsAlive as EffectWithHandler<
            {
              voterAddress: string;
              gaugeAddress: string;
              blockNumber: number;
              eventChainId: number;
            },
            boolean
          >
        ).handler;
        (
          getTokensDeposited as unknown as EffectWithHandler<
            {
              rewardTokenAddress: string;
              gaugeAddress: string;
              blockNumber: number;
              eventChainId: number;
            },
            bigint
          >
        ).handler = (
          originalGetTokensDeposited as EffectWithHandler<
            {
              rewardTokenAddress: string;
              gaugeAddress: string;
              blockNumber: number;
              eventChainId: number;
            },
            bigint
          >
        ).handler;
      });

      it("should update the liquidity pool aggregator with emissions data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.totalEmissions).to.equal(
          expectations.totalEmissions,
        );
        expect(updatedPool?.totalEmissionsUSD).to.equal(
          expectations.totalEmissionsUSD,
        );
        expect(updatedPool?.gaugeIsAlive).to.be.true;
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });

      it("should update the liquidity pool aggregator with votes deposited data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.totalVotesDeposited).to.equal(
          expectations.getTokensDeposited,
          "Should have votes deposited",
        );
        expect(updatedPool?.totalVotesDepositedUSD).to.equal(
          expectations.getTokensDepositedUSD,
          "Should have USD value for votes deposited",
        );
        expect(updatedPool?.gaugeAddress).to.equal(gaugeAddress);
      });

      it("should update the liquidity pool aggregator with gauge is alive data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.gaugeIsAlive).to.be.true;
      });
    });

    describe("when pool entity does not exist", () => {
      it("should return early when pool does not exist", async () => {
        // Mock CHAIN_CONSTANTS rewardToken function
        const originalChainConstants = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstants,
          rewardToken: sandbox.stub().returns(rewardTokenAddress),
        };

        // Mock findPoolByGaugeAddress to return null
        sandbox
          .stub(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .resolves(null);

        const resultDB =
          await SuperchainLeafVoter.DistributeReward.processEvent({
            event: mockEvent,
            mockDb: mockDb,
          });

        // Should not create any entities when pool doesn't exist
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()).length,
        ).to.equal(0);
      });
    });

    describe("when reward token or liquidity pool is missing", () => {
      it("should log warning and return early when reward token is missing", async () => {
        const { mockLiquidityPoolData } = setupCommon();
        const liquidityPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
          totalEmissions: 0n, // Start with 0 to test that it remains unchanged
        } as LiquidityPoolAggregator;

        // Mock CHAIN_CONSTANTS rewardToken function
        const originalChainConstants = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstants,
          rewardToken: sandbox.stub().returns(rewardTokenAddress),
        };

        // Mock findPoolByGaugeAddress to return the pool
        sandbox
          .stub(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .resolves(liquidityPool);

        // Create a fresh database with only the liquidity pool, no reward token
        const freshDb = MockDb.createMockDb();
        const testDb =
          freshDb.entities.LiquidityPoolAggregator.set(liquidityPool);

        const resultDB =
          await SuperchainLeafVoter.DistributeReward.processEvent({
            event: mockEvent,
            mockDb: testDb,
          });

        // Should not update any entities when reward token is missing
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()).length,
        ).to.equal(1);
        const pool = resultDB.entities.LiquidityPoolAggregator.get(
          toChecksumAddress(poolAddress),
        );
        expect(pool?.totalEmissions).to.equal(0n); // Should remain unchanged
      });
    });
  });
});
