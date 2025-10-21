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
import { CHAIN_CONSTANTS } from "../../src/Constants";

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
          },
          poolLauncherPoolId: {
            eq: sinon.stub(),
            gt: sinon.stub(),
          },
        },
      },
      Dynamic_Fee_Swap_Module: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          address: {
            eq: sinon.stub(),
            gt: sinon.stub(),
          },
          chainId: {
            eq: sinon.stub(),
            gt: sinon.stub(),
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
    };
    timestamp = new Date();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("updateDynamicFeePools", () => {
    beforeEach(async () => {
      mockContract = sinon
        .stub(CHAIN_CONSTANTS[10].eth_client, "simulateContract")
        .onCall(0)
        .resolves({
          result: [400, 2000, 10000000n],
          request: {
            address:
              "0x0000000000000000000000000000000000000000" as `0x${string}`,
            abi: [],
            functionName: "mockFunction",
            args: [],
          },
        } as unknown as Awaited<ReturnType<SimulateContractMethod>>);
      mockContract.onCall(1).resolves({
        result: 1900,
        request: {
          address:
            "0x0000000000000000000000000000000000000000" as `0x${string}`,
          abi: [],
          functionName: "mockFunction",
          args: [],
        },
      } as unknown as Awaited<ReturnType<SimulateContractMethod>>);
      liquidityPoolAggregator = {
        ...liquidityPoolAggregator,
        id: "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
      };
      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        contextStub as handlerContext,
        blockNumber,
      );
    });
    afterEach(() => {
      mockContract.reset();
      (contextStub.Dynamic_Fee_Swap_Module?.set as sinon.SinonStub).reset();
    });
    it("should update the dynamic fee pools", async () => {
      const expected_id = `${liquidityPoolAggregator.chainId}-${liquidityPoolAggregator.id}-${blockNumber}`;
      const setStub = contextStub.Dynamic_Fee_Swap_Module
        ?.set as sinon.SinonStub;
      expect(setStub.args[0][0].baseFee).to.equal(400n);
      expect(setStub.args[0][0].feeCap).to.equal(2000n);
      expect(setStub.args[0][0].scalingFactor).to.equal(10000000n);
      expect(setStub.args[0][0].currentFee).to.equal(1900n);
      expect(setStub.args[0][0].id).to.equal(expected_id);
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
