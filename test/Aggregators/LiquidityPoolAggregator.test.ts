import { expect } from "chai";
import sinon from "sinon";
import {
  LiquidityPoolAggregator,
} from "../../generated/src/Types.gen";
import {
  getCurrentAccumulatedFeeCL,
  setLiquidityPoolAggregatorSnapshot,
  updateDynamicFeePools,
  updateLiquidityPoolAggregator,
} from "../../src/Aggregators/LiquidityPoolAggregator";

describe("LiquidityPoolAggregator Functions", () => {
  let contextStub: any;
  let liquidityPoolAggregator: any;
  let timestamp: Date;
  const blockNumber = 131536921;

  beforeEach(() => {
    contextStub = {
      LiquidityPoolAggregatorSnapshot: { set: sinon.stub() },
      LiquidityPoolAggregator: { set: sinon.stub() },
      Dynamic_Fee_Swap_Module: { set: sinon.stub() },
    };
    liquidityPoolAggregator = {
      id: "0x123",
      chainId: 10,
    };
    timestamp = new Date();
  });

  describe("updateDynamicFeePools", () => {
    beforeEach(async () => {
      contextStub.Dynamic_Fee_Swap_Module.set.reset();
      liquidityPoolAggregator.id = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
      await updateDynamicFeePools(liquidityPoolAggregator as LiquidityPoolAggregator, contextStub, blockNumber);
    });
    it("should update the dynamic fee pools", async () => {
      const expected_id = `${liquidityPoolAggregator.chainId}-${liquidityPoolAggregator.id}-${blockNumber}` 
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].baseFee).to.equal(400);
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].feeCap).to.equal(2000);
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].scalingFactor).to.equal(10000000n);
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].currentFee).to.equal(1900);
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].id).to.equal(expected_id);
    });
  });

  describe("getCurrentAccumulatedFeeCL", () => {
    let gaugeFees: any;
    beforeEach(async () => {
      liquidityPoolAggregator.id = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
      gaugeFees = await getCurrentAccumulatedFeeCL(liquidityPoolAggregator.id, liquidityPoolAggregator.chainId, blockNumber);
    });
    it("should fetch accumulated gauge fees for the CL pool", async () => {
      expect(gaugeFees.token0Fees).to.equal(55255516292n);
      expect(gaugeFees.token1Fees).to.equal(18613785323003103999n);
    });
  });

  describe("Snapshot Creation", () => {

    beforeEach(() => {
      setLiquidityPoolAggregatorSnapshot(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        contextStub
      );
    })

    it("should create a snapshot of the liquidity pool aggregator", () => {

      expect(contextStub.LiquidityPoolAggregatorSnapshot.set.calledOnce).to.be
        .true;
      const snapshot =
        contextStub.LiquidityPoolAggregatorSnapshot.set.getCall(0).args[0];
      expect(snapshot.id).to.equal(
        `${liquidityPoolAggregator.chainId}-${
          liquidityPoolAggregator.id
        }_${timestamp.getTime()}`
      );
      expect(snapshot.pool).to.equal(liquidityPoolAggregator.id);
    });

  });

  describe("Updating the Liquidity Pool Aggregator", () => {

    let diff: any;
    beforeEach(() => {
      diff = {
        totalVolume0: 5000n,
        totalVolume1: 6000n,
        totalVolumeUSD: 7000n,
        numberOfSwaps: 11n,
        totalVolumeUSDWhitelisted: 8000n,
        totalFeesUSDWhitelisted: 9000n,
      };
      updateLiquidityPoolAggregator(
        diff,
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        contextStub,
        blockNumber
      );
    })

    it("should update the liquidity pool aggregator", () => {

      const updatedAggregator =
        contextStub.LiquidityPoolAggregator.set.getCall(0).args[0];
      expect(updatedAggregator.totalVolume0).to.equal(diff.totalVolume0);
      expect(updatedAggregator.totalVolume1).to.equal(diff.totalVolume1);
      expect(updatedAggregator.numberOfSwaps).to.equal(diff.numberOfSwaps);
      expect(updatedAggregator.totalVolumeUSDWhitelisted).to.equal(diff.totalVolumeUSDWhitelisted);
      expect(updatedAggregator.totalFeesUSDWhitelisted).to.equal(diff.totalFeesUSDWhitelisted);
    });

    it("should create a snapshot if the last update was more than 1 hour ago", () => {
      const snapshot =
        contextStub.LiquidityPoolAggregatorSnapshot.set.getCall(0).args[0];
      expect(snapshot).to.not.be.undefined;
    });

  });

});
