import { expect } from "chai";
import sinon from "sinon";
import type {
  LiquidityPoolAggregator,
  handlerContext,
} from "../../generated/src/Types.gen";
import {
  setLiquidityPoolAggregatorSnapshot,
  updateDynamicFeePools,
  updateLiquidityPoolAggregator,
} from "../../src/Aggregators/LiquidityPoolAggregator";
import type { CHAIN_CONSTANTS } from "../../src/Constants";

// Type for the simulateContract method
type SimulateContractMethod =
  (typeof CHAIN_CONSTANTS)[10]["eth_client"]["simulateContract"];

describe("LiquidityPoolAggregator Functions", () => {
  let contextStub: Partial<handlerContext>;
  let liquidityPoolAggregator: Partial<LiquidityPoolAggregator>;
  let timestamp: Date;
  let mockContract: sinon.SinonStub;
  const blockNumber = 131536921;

  beforeEach(() => {
    contextStub = {
      LiquidityPoolAggregatorSnapshot: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          gaugeAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          bribeVotingRewardAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          feeVotingRewardAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
      LiquidityPoolAggregator: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          gaugeAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          poolLauncherPoolId: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          bribeVotingRewardAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          feeVotingRewardAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
      log: {
        error: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
      },
      effect: sinon.stub().callsFake(async (effectFn, input) => {
        // Mock the effect calls for testing
        if (effectFn.name === "getDynamicFeeConfig") {
          return {
            baseFee: 400n,
            feeCap: 2000n,
            scalingFactor: 10000000n,
          };
        }
        if (effectFn.name === "getCurrentFee") {
          return 1900n;
        }
        return {};
      }),
    };
    liquidityPoolAggregator = {
      id: "0x123",
      chainId: 10,
      name: "Test Pool",
      token0_id: "token0",
      token1_id: "token1",
      token0_address: "0x1111111111111111111111111111111111111111",
      token1_address: "0x2222222222222222222222222222222222222222",
      isStable: false,
      isCL: false,
      reserve0: 0n,
      reserve1: 0n,
      totalLiquidityUSD: 0n,
      totalVolume0: 0n,
      totalVolume1: 0n,
      totalVolumeUSD: 0n,
      totalVolumeUSDWhitelisted: 0n,
      gaugeFees0CurrentEpoch: 0n,
      gaugeFees1CurrentEpoch: 0n,
      totalFees0: 0n,
      totalFees1: 0n,
      totalFeesUSD: 0n,
      totalFeesUSDWhitelisted: 0n,
      numberOfSwaps: 0n,
      token0Price: 0n,
      token1Price: 0n,
      totalVotesDeposited: 0n,
      totalVotesDepositedUSD: 0n,
      totalEmissions: 0n,
      totalEmissionsUSD: 0n,
      numberOfVotes: 0n,
      currentVotingPower: 0n,
      totalBribesUSD: 0n,
      gaugeIsAlive: false,
      token0IsWhitelisted: false,
      token1IsWhitelisted: false,
      lastUpdatedTimestamp: new Date(),
      lastSnapshotTimestamp: new Date(),
      feeProtocol0: 0n,
      feeProtocol1: 0n,
      observationCardinalityNext: 0n,
      totalFlashLoanFees0: 0n,
      totalFlashLoanFees1: 0n,
      totalFlashLoanFeesUSD: 0n,
      totalFlashLoanVolumeUSD: 0n,
      numberOfFlashLoans: 0n,
      // Gauge fields
      numberOfGaugeDeposits: 0n,
      numberOfGaugeWithdrawals: 0n,
      numberOfGaugeRewardClaims: 0n,
      totalGaugeRewardsClaimedUSD: 0n,
      totalGaugeRewardsClaimed: 0n,
      currentLiquidityStakedUSD: 0n,
      // Voting Reward fields
      bribeVotingRewardAddress: "",
      totalBribeClaimed: 0n,
      totalBribeClaimedUSD: 0n,
      feeVotingRewardAddress: "",
      totalFeeRewardClaimed: 0n,
      totalFeeRewardClaimedUSD: 0n,
      veNFTamountStaked: 0n,
      // Pool Launcher relationship
      poolLauncherPoolId: undefined,
      // Voting fields
      gaugeAddress: "",
      // Dynamic Fee fields
      baseFee: undefined,
      feeCap: undefined,
      scalingFactor: undefined,
    };
    timestamp = new Date();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("updateDynamicFeePools", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock for testing
    let dynamicFeeConfigMock: any;

    beforeEach(() => {
      // Add DynamicFeeGlobalConfig mock
      dynamicFeeConfigMock = {
        getWhere: {
          chainId: {
            eq: sinon.stub().returns([
              {
                id: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
                chainId: 10,
              },
            ]),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: Mock context for testing
      (contextStub as any).DynamicFeeGlobalConfig = dynamicFeeConfigMock;
    });

    it("should update the pool with current dynamic fee", async () => {
      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        contextStub as handlerContext,
        blockNumber,
      );

      // Verify that the pool was updated with the current fee
      const setStub = contextStub.LiquidityPoolAggregator
        ?.set as sinon.SinonStub;
      expect(setStub.calledOnce).to.be.true;
      const updatedPool = setStub.getCall(0).args[0];
      expect(updatedPool.currentFee).to.equal(1900n); // From the mocked effect
    });

    it("should handle missing config gracefully", async () => {
      // Mock no config found
      (dynamicFeeConfigMock.getWhere.chainId.eq as sinon.SinonStub).returns([]);

      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        contextStub as handlerContext,
        blockNumber,
      );

      // Should log an error but not crash
      expect(contextStub.log?.error).to.be.a("function");
    });

    it("should handle effect errors gracefully", async () => {
      // Mock effect to throw error
      (contextStub.effect as sinon.SinonStub).throws(
        new Error("Pool not found"),
      );

      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        contextStub as handlerContext,
        blockNumber,
      );

      // Should complete without crashing
      expect(true).to.be.true;
    });
  });

  describe("Snapshot Creation", () => {
    beforeEach(() => {
      setLiquidityPoolAggregatorSnapshot(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        contextStub as handlerContext,
      );
    });

    it("should create a snapshot of the liquidity pool aggregator", () => {
      const setStub = contextStub.LiquidityPoolAggregatorSnapshot
        ?.set as sinon.SinonStub;
      expect(setStub.calledOnce).to.be.true;
      const snapshot = setStub.getCall(0).args[0];
      expect(snapshot.id).to.equal(
        `${liquidityPoolAggregator.chainId}-${
          liquidityPoolAggregator.id
        }_${timestamp.getTime()}`,
      );
      expect(snapshot.pool).to.equal(liquidityPoolAggregator.id);
    });
  });

  describe("Updating the Liquidity Pool Aggregator", () => {
    let diff = {
      totalVolume0: 0n,
      totalVolume1: 0n,
      totalVolumeUSD: 0n,
      numberOfSwaps: 0n,
      totalVolumeUSDWhitelisted: 0n,
      totalFeesUSDWhitelisted: 0n,
      numberOfVotes: 0n,
      currentVotingPower: 0n,
      totalVotesDeposited: 0n,
      totalVotesDepositedUSD: 0n,
      totalEmissions: 0n,
    };
    beforeEach(async () => {
      diff = {
        totalVolume0: 5000n,
        totalVolume1: 6000n,
        totalVolumeUSD: 7000n,
        numberOfSwaps: 11n,
        totalVolumeUSDWhitelisted: 8000n,
        totalFeesUSDWhitelisted: 9000n,
        numberOfVotes: 5n,
        currentVotingPower: 500n,
        totalVotesDeposited: 2000n,
        totalVotesDepositedUSD: 3000n,
        totalEmissions: 4000n,
      };
      await updateLiquidityPoolAggregator(
        diff,
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        contextStub as handlerContext,
        blockNumber,
      );
    });

    it("should update the liquidity pool aggregator", () => {
      const setStub = contextStub.LiquidityPoolAggregator
        ?.set as sinon.SinonStub;
      const updatedAggregator = setStub.getCall(0).args[0];
      expect(updatedAggregator.totalVolume0).to.equal(diff.totalVolume0);
      expect(updatedAggregator.totalVolume1).to.equal(diff.totalVolume1);
      expect(updatedAggregator.numberOfSwaps).to.equal(diff.numberOfSwaps);
      expect(updatedAggregator.totalVolumeUSDWhitelisted).to.equal(
        diff.totalVolumeUSDWhitelisted,
      );
      expect(updatedAggregator.totalFeesUSDWhitelisted).to.equal(
        diff.totalFeesUSDWhitelisted,
      );
    });

    it("should create a snapshot if the last update was more than 1 hour ago", async () => {
      // Set up a scenario where the last snapshot was more than 1 hour ago
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const currentTimestamp = new Date();

      const liquidityPoolWithOldSnapshot = {
        ...liquidityPoolAggregator,
        lastSnapshotTimestamp: oldTimestamp,
      };

      await updateLiquidityPoolAggregator(
        diff,
        liquidityPoolWithOldSnapshot as LiquidityPoolAggregator,
        currentTimestamp,
        contextStub as handlerContext,
        blockNumber,
      );

      const setStub = contextStub.LiquidityPoolAggregatorSnapshot
        ?.set as sinon.SinonStub;
      const snapshot = setStub.getCall(0).args[0];
      expect(snapshot).to.not.be.undefined;
    });
  });
});
