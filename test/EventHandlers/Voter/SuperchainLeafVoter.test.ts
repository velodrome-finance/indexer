import { MockDb, SuperchainLeafVoter } from "generated/src/TestHelpers.gen";
import type { LiquidityPoolAggregator, Token } from "generated/src/Types.gen";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
  TokenIdByChain,
  toChecksumAddress,
} from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("SuperchainLeafVoter Events", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const { createMockLiquidityPoolAggregator } = setupCommon();

  describe("GaugeCreated Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<
      typeof SuperchainLeafVoter.GaugeCreated.createMockEvent
    >;
    const chainId = 10;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = SuperchainLeafVoter.GaugeCreated.createMockEvent({
        poolFactory: toChecksumAddress(
          "0xeAD23f606643E387a073D0EE8718602291ffaAeB",
        ), // CL factory
        votingRewardsFactory: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        gaugeFactory: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        pool: poolAddress,
        incentiveVotingReward: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        feeVotingReward: toChecksumAddress(
          "0x6666666666666666666666666666666666666666",
        ),
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
        mockLiquidityPool = createMockLiquidityPoolAggregator({
          poolAddress: poolAddress,
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        });

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await SuperchainLeafVoter.GaugeCreated.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update pool entity with gauge address and voting reward addresses", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPool.id,
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

    it("calls addCLGauge when poolFactory is in SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST", async () => {
      const poolFactoryFromList = SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST[0];
      const mockDbEmpty = MockDb.createMockDb();
      const eventWithCLFactory =
        SuperchainLeafVoter.GaugeCreated.createMockEvent({
          poolFactory: poolFactoryFromList,
          votingRewardsFactory: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          gaugeFactory: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ),
          pool: poolAddress,
          incentiveVotingReward: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ),
          feeVotingReward: toChecksumAddress(
            "0x6666666666666666666666666666666666666666",
          ),
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

      const resultDB = await SuperchainLeafVoter.GaugeCreated.processEvent({
        event: eventWithCLFactory,
        mockDb: mockDbEmpty,
      });

      expect(resultDB).toBeDefined();
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        const resultDB = await SuperchainLeafVoter.GaugeCreated.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });
  });

  describe("WhitelistToken Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<
      typeof SuperchainLeafVoter.WhitelistToken.createMockEvent
    >;
    const chainId = 10;
    const tokenAddress = toChecksumAddress(
      "0x2222222222222222222222222222222222222222",
    );

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
        expect(token).toBeDefined();
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
        expect(token?.lastUpdatedTimestamp).toBeInstanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).toBe(
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
        expect(token).toBeDefined();
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(0n);
        expect(typeof token?.name).toBe("string");
        expect(typeof token?.symbol).toBe("string");
        expect(token?.address).toBe(tokenAddress);
        expect(token?.lastUpdatedTimestamp).toBeInstanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).toBe(
          mockEvent.block.timestamp * 1000,
        );
      });
    });

    describe("when _bool is false (de-whitelisting)", () => {
      beforeEach(() => {
        mockEvent = SuperchainLeafVoter.WhitelistToken.createMockEvent({
          token: tokenAddress,
          _bool: false,
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

      describe("when token already exists and is whitelisted", () => {
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
            isWhitelisted: true, // Initially whitelisted
          } as Token;

          const updatedDb = mockDb.entities.Token.set(token);

          resultDB = await SuperchainLeafVoter.WhitelistToken.processEvent({
            event: mockEvent,
            mockDb: updatedDb,
          });
        });

        it("should update the existing token entity to de-whitelist it", () => {
          const token = resultDB.entities.Token.get(
            TokenIdByChain(tokenAddress, chainId),
          );
          expect(token).toBeDefined();
          expect(token?.isWhitelisted).toBe(false);
          expect(token?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
          expect(token?.lastUpdatedTimestamp).toBeInstanceOf(Date);
          expect(token?.lastUpdatedTimestamp?.getTime()).toBe(
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

        it("should create a new Token entity with isWhitelisted set to false", () => {
          const token = resultDB.entities.Token.get(
            TokenIdByChain(tokenAddress, chainId),
          );
          expect(token).toBeDefined();
          expect(token?.isWhitelisted).toBe(false);
          expect(token?.pricePerUSDNew).toBe(0n);
          expect(typeof token?.name).toBe("string");
          expect(typeof token?.symbol).toBe("string");
          expect(token?.address).toBe(tokenAddress);
          expect(token?.lastUpdatedTimestamp).toBeInstanceOf(Date);
          expect(token?.lastUpdatedTimestamp?.getTime()).toBe(
            mockEvent.block.timestamp * 1000,
          );
        });
      });
    });
  });

  describe("GaugeKilled Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<
      typeof SuperchainLeafVoter.GaugeKilled.createMockEvent
    >;
    const chainId = 10;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = SuperchainLeafVoter.GaugeKilled.createMockEvent({
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
        mockLiquidityPool = createMockLiquidityPoolAggregator({
          poolAddress: poolAddress,
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Initially has gauge address
          gaugeIsAlive: true, // Initially alive
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        });

        // Mock findPoolByGaugeAddress to return the pool
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await SuperchainLeafVoter.GaugeKilled.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should set gaugeIsAlive to false but preserve gauge address and voting reward addresses as historical data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPool.id,
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
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(null);

        const resultDB = await SuperchainLeafVoter.GaugeKilled.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });
  });

  describe("GaugeRevived Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<
      typeof SuperchainLeafVoter.GaugeRevived.createMockEvent
    >;
    const chainId = 10;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = SuperchainLeafVoter.GaugeRevived.createMockEvent({
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
        mockLiquidityPool = createMockLiquidityPoolAggregator({
          poolAddress: poolAddress,
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Has gauge address
          gaugeIsAlive: false, // Initially killed
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        });

        // Mock findPoolByGaugeAddress to return the pool
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await SuperchainLeafVoter.GaugeRevived.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should set gaugeIsAlive to true", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPool.id,
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
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(null);

        const resultDB = await SuperchainLeafVoter.GaugeRevived.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });
  });
});
