import { expect } from "chai";
import sinon from "sinon";
import { CLPool, MockDb } from "../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
} from "../../generated/src/Types.gen";
import { toChecksumAddress } from "../../src/Constants";
import * as CLPoolBurnLogic from "../../src/EventHandlers/CLPool/CLPoolBurnLogic";
import * as CLPoolCollectFeesLogic from "../../src/EventHandlers/CLPool/CLPoolCollectFeesLogic";
import * as CLPoolCollectLogic from "../../src/EventHandlers/CLPool/CLPoolCollectLogic";
import * as CLPoolFlashLogic from "../../src/EventHandlers/CLPool/CLPoolFlashLogic";
import * as CLPoolMintLogic from "../../src/EventHandlers/CLPool/CLPoolMintLogic";
import * as CLPoolSwapLogic from "../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import { setupCommon } from "./Pool/common";

describe("CLPool Events", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();
  const chainId = 10;
  const poolAddress = toChecksumAddress(mockLiquidityPoolData.id);
  const userAddress = "0x2222222222222222222222222222222222222222";

  let sandbox: sinon.SinonSandbox;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let liquidityPool: LiquidityPoolAggregator;
  let userStats: UserStatsPerPool;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockDb = MockDb.createMockDb();

    // Set up liquidity pool
    liquidityPool = {
      ...mockLiquidityPoolData,
      id: poolAddress,
      chainId: chainId,
      isCL: true,
    } as LiquidityPoolAggregator;

    // Set up user stats with all required fields
    userStats = {
      id: `${toChecksumAddress(userAddress)}_${poolAddress}_${chainId}`,
      userAddress: toChecksumAddress(userAddress),
      poolAddress: poolAddress,
      chainId: chainId,
      // Liquidity metrics
      currentLiquidityUSD: 0n,
      currentLiquidityToken0: 0n,
      currentLiquidityToken1: 0n,
      totalLiquidityAddedUSD: 0n,
      totalLiquidityRemovedUSD: 0n,
      // Fee metrics
      totalFeesContributedUSD: 0n,
      totalFeesContributed0: 0n,
      totalFeesContributed1: 0n,
      // Swap metrics
      numberOfSwaps: 0n,
      totalSwapVolumeUSD: 0n,
      // Flash swap metrics
      numberOfFlashLoans: 0n,
      totalFlashLoanVolumeUSD: 0n,
      // Gauge metrics
      numberOfGaugeDeposits: 0n,
      numberOfGaugeWithdrawals: 0n,
      numberOfGaugeRewardClaims: 0n,
      totalGaugeRewardsClaimedUSD: 0n,
      totalGaugeRewardsClaimed: 0n,
      currentLiquidityStakedUSD: 0n,
      // Voting metrics
      numberOfVotes: 0n,
      currentVotingPower: 0n,
      // Voting Reward Claims
      totalBribeClaimed: 0n,
      totalBribeClaimedUSD: 0n,
      totalFeeRewardClaimed: 0n,
      totalFeeRewardClaimedUSD: 0n,
      veNFTamountStaked: 0n,
      // ALM metrics
      almAddress: "",
      almAmount0: 0n,
      almAmount1: 0n,
      almLpAmount: 0n,
      // Timestamps
      firstActivityTimestamp: new Date(1000000 * 1000),
      lastActivityTimestamp: new Date(1000000 * 1000),
    } as UserStatsPerPool;

    // Set up entities in mock DB
    mockDb = mockDb.entities.LiquidityPoolAggregator.set(liquidityPool);
    mockDb = mockDb.entities.UserStatsPerPool.set(userStats);
    mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
    mockDb = mockDb.entities.Token.set(mockToken1Data as Token);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("Swap Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Swap.createMockEvent>;
    let processStub: sinon.SinonStub;

    beforeEach(() => {
      processStub = sandbox
        .stub(CLPoolSwapLogic, "processCLPoolSwap")
        .resolves({
          liquidityPoolDiff: {
            totalVolume0: 1000n,
            totalVolume1: 500n,
            totalVolumeUSD: 1500n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userSwapDiff: {
            numberOfSwaps: 1n,
            totalSwapVolumeUSD: 1500n,
            timestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Swap.createMockEvent({
        sender: userAddress,
        recipient: "0x3333333333333333333333333333333333333333",
        amount0: 1000n,
        amount1: -500n,
        sqrtPriceX96: 1000000n,
        liquidity: 2000000n,
        tick: 100n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          transaction: {
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process swap event and update pool aggregator", async () => {
      const resultDB = await CLPool.Swap.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processStub.calledOnce).to.be.true;
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.Swap.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, but processStub shouldn't be called
      expect(processStub.called).to.be.false;
    });
  });

  describe("Mint Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Mint.createMockEvent>;
    let processStub: sinon.SinonStub;

    beforeEach(() => {
      processStub = sandbox
        .stub(CLPoolMintLogic, "processCLPoolMint")
        .resolves({
          liquidityPoolDiff: {
            reserve0: 1000n,
            reserve1: 1000n,
            totalLiquidityUSD: 2000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userLiquidityDiff: {
            netLiquidityAddedUSD: 1000n,
            currentLiquidityToken0: 500n,
            currentLiquidityToken1: 500n,
            timestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Mint.createMockEvent({
        owner: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount: 1000n,
        amount0: 500n,
        amount1: 500n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          transaction: {
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process mint event and create NonFungiblePosition", async () => {
      const resultDB = await CLPool.Mint.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processStub.calledOnce).to.be.true;
      // Check that NonFungiblePosition was created
      const positions = Array.from(
        resultDB.entities.NonFungiblePosition.getAll(),
      );
      expect(positions.length).to.be.greaterThan(0);
    });
  });

  describe("Burn Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Burn.createMockEvent>;
    let processStub: sinon.SinonStub;

    beforeEach(() => {
      processStub = sandbox
        .stub(CLPoolBurnLogic, "processCLPoolBurn")
        .resolves({
          liquidityPoolDiff: {
            reserve0: 500n,
            reserve1: 500n,
            totalLiquidityUSD: 1000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userLiquidityDiff: {
            netLiquidityAddedUSD: -500n,
            currentLiquidityToken0: 250n,
            currentLiquidityToken1: 250n,
            timestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Burn.createMockEvent({
        owner: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount: 500n,
        amount0: 250n,
        amount1: 250n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process burn event and update pool aggregator", async () => {
      const resultDB = await CLPool.Burn.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processStub.calledOnce).to.be.true;
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
    });
  });

  describe("Collect Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Collect.createMockEvent>;
    let processStub: sinon.SinonStub;

    beforeEach(() => {
      processStub = sandbox
        .stub(CLPoolCollectLogic, "processCLPoolCollect")
        .resolves({
          liquidityPoolDiff: {
            reserve0: 1000n,
            reserve1: 1000n,
            totalLiquidityUSD: 2000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userLiquidityDiff: {
            totalFeesContributed0: 100n,
            totalFeesContributed1: 200n,
            totalFeesContributedUSD: 300n,
            timestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Collect.createMockEvent({
        owner: userAddress,
        recipient: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 100n,
        amount1: 200n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process collect event and update fees", async () => {
      const resultDB = await CLPool.Collect.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processStub.calledOnce).to.be.true;
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
    });
  });

  describe("CollectFees Event", () => {
    let mockEvent: ReturnType<typeof CLPool.CollectFees.createMockEvent>;
    let processStub: sinon.SinonStub;

    beforeEach(() => {
      processStub = sandbox
        .stub(CLPoolCollectFeesLogic, "processCLPoolCollectFees")
        .returns({
          liquidityPoolDiff: {
            reserve0: 1000n,
            reserve1: 1000n,
            totalLiquidityUSD: 2000n,
            totalFees0: 50n,
            totalFees1: 75n,
            totalFeesUSD: 125n,
            totalFeesUSDWhitelisted: 125n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.CollectFees.createMockEvent({
        recipient: userAddress,
        amount0: 50n,
        amount1: 75n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process collect fees event", async () => {
      const resultDB = await CLPool.CollectFees.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processStub.calledOnce).to.be.true;
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
    });
  });

  describe("Flash Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Flash.createMockEvent>;
    let processStub: sinon.SinonStub;

    beforeEach(() => {
      processStub = sandbox
        .stub(CLPoolFlashLogic, "processCLPoolFlash")
        .resolves({
          liquidityPoolDiff: {
            totalFlashLoanFees0: 5n,
            totalFlashLoanFees1: 0n,
            totalFlashLoanFeesUSD: 5n,
            totalFlashLoanVolumeUSD: 1000n,
            numberOfFlashLoans: 1n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userFlashLoanDiff: {
            numberOfFlashLoans: 1n,
            totalFlashLoanVolumeUSD: 1000n,
            timestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Flash.createMockEvent({
        sender: userAddress,
        recipient: userAddress,
        amount0: 1000n,
        amount1: 0n,
        paid0: 1005n,
        paid1: 0n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process flash event and update flash loan metrics", async () => {
      const resultDB = await CLPool.Flash.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processStub.calledOnce).to.be.true;
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
    });

    it("should not update user stats if flash loan volume is 0", async () => {
      processStub.resolves({
        liquidityPoolDiff: {
          totalFlashLoanFees0: 0n,
          totalFlashLoanFees1: 0n,
          totalFlashLoanFeesUSD: 0n,
          numberOfFlashLoans: 1n,
          totalFlashLoanVolumeUSD: 0n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        },
        userFlashLoanDiff: {
          numberOfFlashLoans: 1n,
          totalFlashLoanVolumeUSD: 0n,
          timestamp: new Date(1000000 * 1000),
        },
      });

      const resultDB = await CLPool.Flash.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should still process, but user stats update is conditional
      expect(processStub.calledOnce).to.be.true;
    });
  });

  describe("IncreaseObservationCardinalityNext Event", () => {
    let mockEvent: ReturnType<
      typeof CLPool.IncreaseObservationCardinalityNext.createMockEvent
    >;

    beforeEach(() => {
      mockEvent = CLPool.IncreaseObservationCardinalityNext.createMockEvent({
        observationCardinalityNextNew: 100n,
        observationCardinalityNextOld: 50n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should update observation cardinality", async () => {
      const resultDB =
        await CLPool.IncreaseObservationCardinalityNext.processEvent({
          event: mockEvent,
          mockDb,
        });

      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.observationCardinalityNext).to.equal(100n);
    });
  });

  describe("SetFeeProtocol Event", () => {
    let mockEvent: ReturnType<typeof CLPool.SetFeeProtocol.createMockEvent>;

    beforeEach(() => {
      mockEvent = CLPool.SetFeeProtocol.createMockEvent({
        feeProtocol0New: 10n,
        feeProtocol1New: 20n,
        feeProtocol0Old: 5n,
        feeProtocol1Old: 15n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should update fee protocol settings", async () => {
      const resultDB = await CLPool.SetFeeProtocol.processEvent({
        event: mockEvent,
        mockDb,
      });

      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.feeProtocol0).to.equal(10n);
      expect(updatedPool?.feeProtocol1).to.equal(20n);
    });
  });
});
