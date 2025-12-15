import { expect } from "chai";
import { MockDb, Voter } from "generated/src/TestHelpers.gen";
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

describe("Voter Events", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("Voted Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.Voted.createMockEvent>;
    const chainId = 10; // Optimism
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const voterAddress = "0x1111111111111111111111111111111111111111";

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.Voted.createMockEvent({
        voter: voterAddress,
        pool: poolAddress,
        tokenId: 1n,
        weight: 100n,
        totalWeight: 1000n,
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
          veNFTamountStaked: 0n,
        } as LiquidityPoolAggregator;

        mockUserStats = createMockUserStatsPerPool({
          userAddress: voterAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          veNFTamountStaked: 0n,
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });

        // Setup mock database with required entities
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);
        mockDb = mockDb.entities.UserStatsPerPool.set(mockUserStats);
        mockDb = mockDb.entities.Token.set(mockToken0Data);
        mockDb = mockDb.entities.Token.set(mockToken1Data);

        resultDB = await Voter.Voted.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update liquidity pool aggregator with voting data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          toChecksumAddress(poolAddress),
        );
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.veNFTamountStaked).to.equal(1000n);
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });

      it("should update user stats per pool with voting data", () => {
        const userStatsId = `${toChecksumAddress(voterAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
        const updatedUserStats =
          resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(updatedUserStats).to.not.be.undefined;
        expect(updatedUserStats?.veNFTamountStaked).to.equal(100n);
        expect(updatedUserStats?.lastActivityTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating pool entities", async () => {
        const resultDB = await Voter.Voted.processEvent({
          event: mockEvent,
          mockDb,
        });

        // Should not create LiquidityPoolAggregator entity
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()).length,
        ).to.equal(0);
        // loadUserData is called in parallel and creates UserStatsPerPool even if pool doesn't exist
        // This is expected behavior - the entity is created but not updated
        expect(
          Array.from(resultDB.entities.UserStatsPerPool.getAll()).length,
        ).to.equal(1);
      });
    });
  });

  describe("Abstained Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.Abstained.createMockEvent>;
    const chainId = 10; // Optimism
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const voterAddress = "0x1111111111111111111111111111111111111111";

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.Abstained.createMockEvent({
        voter: voterAddress,
        pool: poolAddress,
        tokenId: 1n,
        weight: 100n,
        totalWeight: 1000n,
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
          veNFTamountStaked: 2000n, // Initial staked amount
        } as LiquidityPoolAggregator;

        mockUserStats = createMockUserStatsPerPool({
          userAddress: voterAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          veNFTamountStaked: 200n, // Initial user staked amount
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });

        // Setup mock database with required entities
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);
        mockDb = mockDb.entities.UserStatsPerPool.set(mockUserStats);
        mockDb = mockDb.entities.Token.set(mockToken0Data);
        mockDb = mockDb.entities.Token.set(mockToken1Data);

        resultDB = await Voter.Abstained.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update liquidity pool aggregator with total weight (absolute value)", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          toChecksumAddress(poolAddress),
        );
        expect(updatedPool).to.not.be.undefined;
        // totalWeight is the absolute total veNFT staked in pool, replacing previous value
        expect(updatedPool?.veNFTamountStaked).to.equal(1000n); // event.params.totalWeight
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });

      it("should decrease user stats veNFT amount staked (negative weight)", () => {
        const userStatsId = `${toChecksumAddress(voterAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
        const updatedUserStats =
          resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(updatedUserStats).to.not.be.undefined;
        // weight is subtracted (negative because it's a withdrawal)
        expect(updatedUserStats?.veNFTamountStaked).to.equal(100n); // 200n - 100n
        expect(updatedUserStats?.lastActivityTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating pool entities", async () => {
        const resultDB = await Voter.Abstained.processEvent({
          event: mockEvent,
          mockDb,
        });

        // Should not create LiquidityPoolAggregator entity
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()).length,
        ).to.equal(0);
        // loadUserData is called in parallel and creates UserStatsPerPool even if pool doesn't exist
        // This is expected behavior - the entity is created but not updated
        expect(
          Array.from(resultDB.entities.UserStatsPerPool.getAll()).length,
        ).to.equal(1);
      });
    });
  });

  describe("GaugeCreated Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeCreated.createMockEvent>;
    const chainId = 10;
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.GaugeCreated.createMockEvent({
        poolFactory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", // VAMM factory
        votingRewardsFactory: "0x2222222222222222222222222222222222222222",
        gaugeFactory: "0x3333333333333333333333333333333333333333",
        pool: poolAddress,
        bribeVotingReward: "0x5555555555555555555555555555555555555555",
        feeVotingReward: "0x6666666666666666666666666666666666666666",
        gauge: gaugeAddress,
        creator: "0x7777777777777777777777777777777777777777",
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
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        } as LiquidityPoolAggregator;

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await Voter.GaugeCreated.processEvent({
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
        const resultDB = await Voter.GaugeCreated.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()).length,
        ).to.equal(0);
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
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        } as LiquidityPoolAggregator;

        // Create event with CL factory address (from CLPOOLS_FACTORY_LIST)
        clFactoryEvent = Voter.GaugeCreated.createMockEvent({
          poolFactory: "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F", // CL factory (optimism)
          votingRewardsFactory: "0x2222222222222222222222222222222222222222",
          gaugeFactory: "0x3333333333333333333333333333333333333333",
          pool: poolAddress,
          bribeVotingReward: "0x5555555555555555555555555555555555555555",
          feeVotingReward: "0x6666666666666666666666666666666666666666",
          gauge: gaugeAddress,
          creator: "0x7777777777777777777777777777777777777777",
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

        resultDB = await Voter.GaugeCreated.processEvent({
          event: clFactoryEvent,
          mockDb,
        });
      });

      it("should update pool entity with gauge address (CL factory path)", () => {
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
      });
    });
  });

  describe("GaugeKilled Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeKilled.createMockEvent>;
    const chainId = 10;
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";

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
      const feeVotingRewardAddress =
        "0x6572b2b30f63B960608f3aA5205711C558998398";
      const bribeVotingRewardAddress =
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1";

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Initially has gauge address
          gaugeIsAlive: true, // Initially alive
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        } as LiquidityPoolAggregator;

        // Mock findPoolByGaugeAddress to return the pool
        sandbox
          .stub(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .resolves(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await Voter.GaugeKilled.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      afterEach(() => {});

      it("should set gaugeIsAlive to false but preserve gauge address and voting reward addresses as historical data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          toChecksumAddress(poolAddress),
        );
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.gaugeIsAlive).to.equal(false); // Should be set to false
        // Gauge address should be preserved as historical data
        expect(updatedPool?.gaugeAddress).to.equal(gaugeAddress);
        // Voting reward addresses should be preserved as historical data
        expect(updatedPool?.feeVotingRewardAddress).to.equal(
          feeVotingRewardAddress,
        );
        expect(updatedPool?.bribeVotingRewardAddress).to.equal(
          bribeVotingRewardAddress,
        );
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        // Mock findPoolByGaugeAddress to return null
        sandbox
          .stub(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .resolves(null);

        const resultDB = await Voter.GaugeKilled.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()).length,
        ).to.equal(0);
      });
    });
  });

  describe("WhitelistToken event", () => {
    let resultDB: ReturnType<typeof MockDb.createMockDb>;
    let expectedId: string;
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.WhitelistToken.createMockEvent>;

    beforeEach(async () => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.WhitelistToken.createMockEvent({
        whitelister: "0x1111111111111111111111111111111111111111",
        token: "0x2222222222222222222222222222222222222222",
        _bool: true,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
        },
      });
    });
    describe("if token is in the db", () => {
      const expectedPricePerUSDNew = BigInt(10000000);
      beforeEach(async () => {
        // Note token doesn't have lastUpdatedTimestamp due to bug in codegen.
        // Will cast during the set call.
        const token = {
          id: TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
          address: "0x2222222222222222222222222222222222222222",
          symbol: "TEST",
          name: "TEST",
          chainId: 10,
          decimals: BigInt(18),
          pricePerUSDNew: expectedPricePerUSDNew,
          isWhitelisted: false,
        };

        const updatedDB1 = mockDb.entities.Token.set(token as Token);

        resultDB = await Voter.WhitelistToken.processEvent({
          event: mockEvent,
          mockDb: updatedDB1,
        });

        expectedId = `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
      });

      it("should update the token entity", async () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
        );
        expect(token?.isWhitelisted).to.be.true;
        expect(token?.pricePerUSDNew).to.equal(expectedPricePerUSDNew);
      });

      it("should update lastUpdatedTimestamp when updating existing token", async () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
        );
        expect(token?.lastUpdatedTimestamp).to.be.instanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).to.equal(
          mockEvent.block.timestamp * 1000,
        );
      });
    });
    describe("if token is not in the db", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let expectedId: string;
      beforeEach(async () => {
        resultDB = await Voter.WhitelistToken.processEvent({
          event: mockEvent,
          mockDb: mockDb,
        });

        expectedId = `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
      });

      it("should create a new Token entity", async () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
        );
        expect(token?.isWhitelisted).to.be.true;
        expect(token?.pricePerUSDNew).to.equal(0n);
        expect(token?.name).to.be.a("string");
        expect(token?.symbol).to.be.a("string");
        expect(token?.address).to.equal(
          "0x2222222222222222222222222222222222222222",
        );
      });

      it("should set lastUpdatedTimestamp when creating new token", async () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
        );
        expect(token?.lastUpdatedTimestamp).to.be.instanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).to.equal(
          mockEvent.block.timestamp * 1000,
        );
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
    const voterAddress = "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C";
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";
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
        resultDB = await Voter.DistributeReward.processEvent({
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
        expect(updatedPool?.totalVotesDeposited).to.equal(
          expectations.getTokensDeposited,
        );
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
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
          new Date(1000000 * 1000),
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

        const resultDB = await Voter.DistributeReward.processEvent({
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

        const resultDB = await Voter.DistributeReward.processEvent({
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
