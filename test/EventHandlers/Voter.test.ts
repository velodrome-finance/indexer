import { expect } from "chai";
import { MockDb, Voter } from "../../generated/src/TestHelpers.gen";
import { TokenIdByChain, CHAIN_CONSTANTS } from "../../src/Constants";
import { Token, LiquidityPoolAggregator } from "../../generated/src/Types.gen";
import * as Store from "../../src/Store";
import sinon from "sinon";
import { setupCommon } from "./Pool/common";
import * as Common from "../../src/EventHandlers/Voter/common";

describe("Voter Events", () => {
  describe("WhitelistToken event", () => {
    let resultDB: ReturnType<typeof MockDb.createMockDb>;
    let expectedId: string;
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: any;
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

        resultDB = await Voter.WhitelistToken.processEvent({ event: mockEvent, mockDb: updatedDB1 });

        expectedId = `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
      });
      it("should create a new WhitelistToken entity", async () => {
        const whitelistTokenEvent = resultDB.entities.Voter_WhitelistToken.get(expectedId);
        expect(whitelistTokenEvent).to.not.be.undefined;
        expect(whitelistTokenEvent?.whitelister).to.equal("0x1111111111111111111111111111111111111111");
        expect(whitelistTokenEvent?.token).to.equal("0x2222222222222222222222222222222222222222");
        expect(whitelistTokenEvent?.isWhitelisted).to.be.true;
        expect(whitelistTokenEvent?.timestamp).to.deep.equal(new Date(1000000 * 1000));
        expect(whitelistTokenEvent?.chainId).to.equal(10);
      });

      it("should update the token entity", async () => {
        const token = resultDB.entities.Token.get(TokenIdByChain("0x2222222222222222222222222222222222222222", 10));
        expect(token?.isWhitelisted).to.be.true;
        expect(token?.pricePerUSDNew).to.equal(expectedPricePerUSDNew);
      });

    });
    describe("if token is not in the db", () => {

      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let expectedId: string;
      beforeEach(async () => {

        resultDB = await Voter.WhitelistToken.processEvent({ event: mockEvent, mockDb: mockDb });

        expectedId = `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
      });
      it("should create a new WhitelistToken entity", async () => {
        const whitelistTokenEvent = resultDB.entities.Voter_WhitelistToken.get(expectedId);
        expect(whitelistTokenEvent).to.not.be.undefined;
        expect(whitelistTokenEvent?.whitelister).to.equal("0x1111111111111111111111111111111111111111");
        expect(whitelistTokenEvent?.token).to.equal("0x2222222222222222222222222222222222222222");
        expect(whitelistTokenEvent?.isWhitelisted).to.be.true;
        expect(whitelistTokenEvent?.timestamp).to.deep.equal(new Date(1000000 * 1000));
        expect(whitelistTokenEvent?.chainId).to.equal(10);
      });

      it("should create a new Token entity", async () => {
        const token = resultDB.entities.Token.get(TokenIdByChain("0x2222222222222222222222222222222222222222", 10));
        expect(token?.isWhitelisted).to.be.true;
        expect(token?.pricePerUSDNew).to.equal(0n);
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

    const rewardTokenAddress = CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

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
          srcAddress: voterAddress
        },
      });


    });


    describe("when reward token and liquidity pool exist", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let updatedDB: ReturnType<typeof MockDb.createMockDb>;
      let expectedId: string;

      const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } = setupCommon();
      let expectations: any = {};
      
      beforeEach(async () => {
        const liquidityPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: poolAddress,
          chainId: chainId,
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
        } as Token;

        expectations = {
          totalEmissions: liquidityPool.totalEmissions + mockEvent.params.amount,
          totalEmissionsUSD: liquidityPool.totalEmissionsUSD + 
            mockEvent.params.amount * rewardToken.pricePerUSDNew / 10n ** rewardToken.decimals,
          getTokensDeposited: 500n * 10n ** 18n,
          getTokensDepositedUSD: 500n * 10n ** 18n * rewardToken.pricePerUSDNew / 10n ** rewardToken.decimals,
        };

        sinon.stub(Common, "getIsAlive").resolves(true);
        sinon.stub(Common, "getTokensDeposited").resolves(expectations.getTokensDeposited);
        sinon.stub(Store.poolLookupStoreManager(), "getPoolAddressByGaugeAddress")
          .returns(poolAddress);


        // Set entities in the mock database
        updatedDB = mockDb.entities.Token.set(rewardToken);
        updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(liquidityPool);

        expectedId = `${chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;

        // Process the event
        resultDB = await Voter.DistributeReward.processEvent({
          event: mockEvent,
          mockDb: updatedDB,
        });
      });

      afterEach(() => {
        sinon.restore();
      });

      it("should create a new DistributeReward entity", () => {
        const distributeRewardEntity = resultDB.entities.Voter_DistributeReward.get(expectedId);
        expect(distributeRewardEntity).to.not.be.undefined;
        expect(distributeRewardEntity?.chainId).to.equal(chainId);
        expect(distributeRewardEntity?.amount).to.equal(mockEvent.params.amount);
        expect(distributeRewardEntity?.tokensDeposited).to.equal(expectations.getTokensDeposited);
      });

      it("should update the liquidity pool aggregator with emissions data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.totalEmissions).to.equal(expectations.totalEmissions);
        expect(updatedPool?.totalEmissionsUSD).to.equal(expectations.totalEmissionsUSD);
        expect(updatedPool?.gaugeIsAlive).to.be.true;
        expect(updatedPool?.totalVotesDeposited).to.equal(expectations.getTokensDeposited);
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(new Date(1000000 * 1000));
      });
      it("should update the liquidity pool aggregator with votes deposited data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.totalVotesDeposited).to.equal(expectations.getTokensDeposited, "Should have votes deposited");
        expect(updatedPool?.totalVotesDepositedUSD).to.equal(expectations.getTokensDepositedUSD, "Should have USD value for votes deposited");
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(new Date(1000000 * 1000));
      });
      it("should update the liquidity pool aggregator with gauge is alive data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.gaugeIsAlive).to.be.true;
      });
    });
  });
});
