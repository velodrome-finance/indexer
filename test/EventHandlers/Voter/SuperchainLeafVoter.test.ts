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

  describe("WhitelistToken Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<
      typeof SuperchainLeafVoter.WhitelistToken.createMockEvent
    >;
    const chainId = 10;
    const tokenAddress = "0x2222222222222222222222222222222222222222";

    beforeEach(async () => {
      mockDb = MockDb.createMockDb();
      mockEvent = SuperchainLeafVoter.WhitelistToken.createMockEvent({
        token: tokenAddress,
        _bool: true,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId,
          logIndex: 1,
        },
      });
    });

    describe("when token already exists", () => {
      const expectedPricePerUSDNew = BigInt(10000000);
      let resultDB: ReturnType<typeof MockDb.createMockDb>;

      beforeEach(async () => {
        const token: Token = {
          id: TokenIdByChain(tokenAddress, chainId),
          address: tokenAddress,
          symbol: "TEST",
          name: "TEST",
          chainId,
          decimals: BigInt(18),
          pricePerUSDNew: expectedPricePerUSDNew,
          isWhitelisted: false,
        } as Token;

        const updatedDb = mockDb.entities.Token.set(token);

        resultDB = await SuperchainLeafVoter.WhitelistToken.processEvent({
          event: mockEvent,
          mockDb: updatedDb,
        });
      });

      it("should update the existing token entity", () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain(tokenAddress, chainId),
        );
        expect(token).to.not.be.undefined;
        expect(token?.isWhitelisted).to.be.true;
        expect(token?.pricePerUSDNew).to.equal(expectedPricePerUSDNew);
        expect(token?.lastUpdatedTimestamp).to.be.instanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).to.equal(
          mockEvent.block.timestamp * 1000,
        );
      });
    });

    describe("when token does not exist yet", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;

      beforeEach(async () => {
        resultDB = await SuperchainLeafVoter.WhitelistToken.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should create a new Token entity with whitelisted flag", () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain(tokenAddress, chainId),
        );
        expect(token).to.not.be.undefined;
        expect(token?.isWhitelisted).to.be.true;
        expect(token?.pricePerUSDNew).to.equal(0n);
        expect(token?.name).to.be.a("string");
        expect(token?.symbol).to.be.a("string");
        expect(token?.address).to.equal(tokenAddress);
        expect(token?.lastUpdatedTimestamp).to.be.instanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).to.equal(
          mockEvent.block.timestamp * 1000,
        );
      });
    });
  });
});
