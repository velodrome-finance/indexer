import type {
  UserStatsPerPool,
  VeNFTPoolVote,
  VeNFTState,
  VeNFT_Deposit_event,
  VeNFT_Transfer_event,
  VeNFT_Withdraw_event,
  handlerContext,
} from "../../../generated";
import * as VeNFTPoolVoteAggregator from "../../../src/Aggregators/VeNFTPoolVote";
import * as VeNFTStateAggregator from "../../../src/Aggregators/VeNFTState";
import {
  VeNFTId,
  VeNFTPoolVoteId,
  toChecksumAddress,
} from "../../../src/Constants";
import * as VeNFTLogic from "../../../src/EventHandlers/VeNFT/VeNFTLogic";

describe("VeNFTLogic", () => {
  const mockVeNFTPoolVoteStore = {
    getWhere: {
      veNFTState_id: {
        eq: jest.fn().mockResolvedValue([]),
      },
    },
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockUserStatsStore = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
  };

  const mockContext = {
    log: {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    VeNFTPoolVote: mockVeNFTPoolVoteStore,
    UserStatsPerPool: mockUserStatsStore,
  } as unknown as handlerContext;

  const mockVeNFTState: VeNFTState = {
    id: VeNFTId(10, 1n),
    chainId: 10,
    tokenId: 1n,
    owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    locktime: 100n,
    lastUpdatedTimestamp: new Date(10000 * 1000),
    totalValueLocked: 100n,
    isAlive: true,
  };

  const createMockDepositEvent = (): VeNFT_Deposit_event => ({
    params: {
      provider: "0x2222222222222222222222222222222222222222",
      tokenId: 1n,
      value: 50n,
      locktime: 200n,
      depositType: 1n,
      ts: 100n,
    },
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    },
    chainId: 10,
    logIndex: 1,
    srcAddress: "0x3333333333333333333333333333333333333333",
    transaction: {
      hash: "0x1111111111111111111111111111111111111111",
    },
  });

  describe("processVeNFTDeposit", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should call updateVeNFTState with the proper diff", async () => {
      const mockDepositEvent = createMockDepositEvent();
      const timestamp = new Date(mockDepositEvent.block.timestamp * 1000);
      const updateSpy = jest
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTDeposit(
        mockDepositEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(updateSpy).toHaveBeenCalledWith(
        {
          locktime: 200n,
          incrementalTotalValueLocked: 50n,
          isAlive: true,
          lastUpdatedTimestamp: timestamp,
        },
        mockVeNFTState,
        timestamp,
        mockContext,
      );
    });
  });

  describe("processVeNFTTransfer", () => {
    const mockTransferEvent: VeNFT_Transfer_event = {
      params: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        tokenId: 1n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: "0x3333333333333333333333333333333333333333",
      transaction: {
        hash: "0x1111111111111111111111111111111111111111",
      },
    } as VeNFT_Transfer_event;

    beforeEach(() => {
      jest.clearAllMocks();
      jest
        .spyOn(VeNFTLogic, "reassignVeNFTVotesOnTransfer")
        .mockResolvedValue(undefined);
    });

    it("should update VeNFTState and reassign votes on transfer", async () => {
      const timestamp = new Date(mockTransferEvent.block.timestamp * 1000);
      const updateSpy = jest
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTTransfer(
        mockTransferEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(updateSpy).toHaveBeenCalledWith(
        {
          owner: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          lastUpdatedTimestamp: timestamp,
          isAlive: true,
        },
        mockVeNFTState,
        timestamp,
        mockContext,
      );
    });

    it("should handle transfer to zero address (burn) and mark isAlive false", async () => {
      const burnEvent = {
        ...mockTransferEvent,
        params: {
          ...mockTransferEvent.params,
          to: "0x0000000000000000000000000000000000000000",
        },
      } as VeNFT_Transfer_event;
      const timestamp = new Date(burnEvent.block.timestamp * 1000);
      const updateSpy = jest
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTTransfer(
        burnEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(updateSpy).toHaveBeenCalledWith(
        {
          owner: "0x0000000000000000000000000000000000000000",
          lastUpdatedTimestamp: timestamp,
          isAlive: false,
        },
        mockVeNFTState,
        timestamp,
        mockContext,
      );
    });
  });

  describe("processVeNFTWithdraw", () => {
    const mockWithdrawEvent: VeNFT_Withdraw_event = {
      params: {
        provider: "0x1111111111111111111111111111111111111111",
        tokenId: 1n,
        value: 25n,
        ts: 100n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: "0x3333333333333333333333333333333333333333",
      transaction: {
        hash: "0x1111111111111111111111111111111111111111",
      },
    } as VeNFT_Withdraw_event;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should call updateVeNFTState with the proper diff", async () => {
      const timestamp = new Date(mockWithdrawEvent.block.timestamp * 1000);
      const updateSpy = jest
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTWithdraw(
        mockWithdrawEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(updateSpy).toHaveBeenCalledWith(
        {
          incrementalTotalValueLocked: -25n,
          lastUpdatedTimestamp: timestamp,
        },
        mockVeNFTState,
        timestamp,
        mockContext,
      );
    });
  });

  describe("reassignVeNFTVotesOnTransfer", () => {
    let loadPoolVotesSpy: jest.SpyInstance;

    const mockTransferEvent: VeNFT_Transfer_event = {
      params: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        tokenId: 1n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: "0x3333",
      transaction: { hash: "0xabcd" },
    } as VeNFT_Transfer_event;

    beforeEach(() => {
      loadPoolVotesSpy = jest.spyOn(
        VeNFTPoolVoteAggregator,
        "loadPoolVotesByVeNFT",
      );
    });

    it("skips reassignment when previous owner equals new owner", async () => {
      const sameOwnerState: VeNFTState = {
        ...mockVeNFTState,
        owner: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      };

      await VeNFTLogic.reassignVeNFTVotesOnTransfer(
        {
          ...mockTransferEvent,
          params: { ...mockTransferEvent.params, to: sameOwnerState.owner },
        },
        sameOwnerState,
        mockContext,
      );

      expect(loadPoolVotesSpy).not.toHaveBeenCalled();
    });

    it("loads pool votes and processes each pool with non-zero votes", async () => {
      const poolVotes = [
        {
          id: VeNFTPoolVoteId(10, 1n, "0xpool1"),
          poolAddress: "0xpool1",
          veNFTamountStaked: 50n,
          veNFTState_id: mockVeNFTState.id,
          lastUpdatedTimestamp: new Date(0),
        },
      ] as VeNFTPoolVote[];

      (
        mockContext.VeNFTPoolVote.getWhere.veNFTState_id.eq as jest.Mock
      ).mockResolvedValue(poolVotes);

      await VeNFTLogic.reassignVeNFTVotesOnTransfer(
        mockTransferEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(
        mockContext.VeNFTPoolVote.getWhere.veNFTState_id.eq,
      ).toHaveBeenCalledWith(mockVeNFTState.id);
    });

    it("skips pool votes with zero veNFTamountStaked", async () => {
      const poolVotes = [
        {
          id: VeNFTPoolVoteId(10, 1n, "0xpool0"),
          poolAddress: "0xpool0",
          veNFTamountStaked: 0n,
          veNFTState_id: mockVeNFTState.id,
          lastUpdatedTimestamp: new Date(0),
        },
        {
          id: VeNFTPoolVoteId(10, 1n, "0xpool1"),
          poolAddress: "0xpool1",
          veNFTamountStaked: 50n,
          veNFTState_id: mockVeNFTState.id,
          lastUpdatedTimestamp: new Date(0),
        },
      ] as VeNFTPoolVote[];

      const eqMock = mockContext.VeNFTPoolVote.getWhere.veNFTState_id
        .eq as jest.Mock;
      eqMock.mockImplementation(() => Promise.resolve(poolVotes));

      const previousOwnerId = `10-${mockVeNFTState.owner}-0xpool1`;
      const newOwnerId = `10-${mockTransferEvent.params.to}-0xpool1`;
      const previousOwnerStats = {
        id: previousOwnerId,
        userAddress: mockVeNFTState.owner,
        poolAddress: "0xpool1",
        chainId: 10,
        veNFTamountStaked: 100n,
        lastActivityTimestamp: new Date(0),
      } as UserStatsPerPool;
      const newOwnerStats = {
        id: newOwnerId,
        userAddress: mockTransferEvent.params.to,
        poolAddress: "0xpool1",
        chainId: 10,
        veNFTamountStaked: 0n,
        lastActivityTimestamp: new Date(0),
      } as UserStatsPerPool;
      jest
        .mocked(mockContext.UserStatsPerPool?.get)
        .mockImplementation((id: string) =>
          Promise.resolve(
            id === previousOwnerId
              ? previousOwnerStats
              : id === newOwnerId
                ? newOwnerStats
                : undefined,
          ),
        );

      const updateUserStatsSpy = jest.spyOn(
        await import("../../../src/Aggregators/UserStatsPerPool"),
        "updateUserStatsPerPool",
      );

      await VeNFTLogic.reassignVeNFTVotesOnTransfer(
        mockTransferEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(updateUserStatsSpy).toHaveBeenCalledTimes(2);
      expect(updateUserStatsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalVeNFTamountStaked: -50n,
        }),
        previousOwnerStats,
        mockContext,
      );
      expect(updateUserStatsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalVeNFTamountStaked: 50n,
        }),
        newOwnerStats,
        mockContext,
      );
    });
  });

  describe("updatePreviousOwnerUserStatsOnTransfer", () => {
    const mockTransferEvent: VeNFT_Transfer_event = {
      params: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        tokenId: 1n,
      },
      block: { timestamp: 1000000, number: 1, hash: "0x" },
      chainId: 10,
      logIndex: 1,
      srcAddress: "0x",
      transaction: { hash: "0x" },
    } as VeNFT_Transfer_event;

    it("logs warn and skips update when previous owner UserStatsPerPool is missing", async () => {
      jest
        .mocked(mockContext.UserStatsPerPool?.get)
        .mockResolvedValue(undefined);
      jest.mocked(mockContext.UserStatsPerPool?.set).mockClear();

      await VeNFTLogic.updatePreviousOwnerUserStatsOnTransfer(
        mockTransferEvent,
        "0x1111111111111111111111111111111111111111",
        "0xpool1",
        50n,
        mockContext,
      );

      expect(mockContext.log?.warn).toHaveBeenCalledWith(
        expect.stringContaining("UserStatsPerPool missing for old owner"),
      );
      expect(mockContext.UserStatsPerPool?.set).not.toHaveBeenCalled();
    });

    it("calls updateUserStatsPerPool with negative delta when previous owner exists", async () => {
      const existingUserStats = {
        id: "10-0x1111111111111111111111111111111111111111-0xpool1",
        userAddress: "0x1111111111111111111111111111111111111111",
        poolAddress: "0xpool1",
        chainId: 10,
        veNFTamountStaked: 100n,
        lastActivityTimestamp: new Date(0),
      } as UserStatsPerPool;
      jest
        .mocked(mockContext.UserStatsPerPool?.get)
        .mockResolvedValue(existingUserStats);

      const updateUserStatsSpy = jest.spyOn(
        await import("../../../src/Aggregators/UserStatsPerPool"),
        "updateUserStatsPerPool",
      );

      await VeNFTLogic.updatePreviousOwnerUserStatsOnTransfer(
        mockTransferEvent,
        "0x1111111111111111111111111111111111111111",
        "0xpool1",
        50n,
        mockContext,
      );

      expect(updateUserStatsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalVeNFTamountStaked: -50n,
        }),
        existingUserStats,
        mockContext,
      );
    });
  });

  describe("updateNewOwnerUserStatsOnTransfer", () => {
    const mockTransferEvent: VeNFT_Transfer_event = {
      params: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        tokenId: 1n,
      },
      block: { timestamp: 1000000, number: 1, hash: "0x" },
      chainId: 10,
      logIndex: 1,
      srcAddress: "0x",
      transaction: { hash: "0x" },
    } as VeNFT_Transfer_event;

    it("skips update when new owner is zero address (burn)", async () => {
      const loadOrCreateSpy = jest.spyOn(
        await import("../../../src/Aggregators/UserStatsPerPool"),
        "loadOrCreateUserData",
      );

      await VeNFTLogic.updateNewOwnerUserStatsOnTransfer(
        mockTransferEvent,
        "0x0000000000000000000000000000000000000000",
        "0xpool1",
        50n,
        mockContext,
      );

      expect(loadOrCreateSpy).not.toHaveBeenCalled();
    });

    it("calls updateUserStatsPerPool with positive delta when new owner is not burn", async () => {
      jest
        .mocked(mockContext.UserStatsPerPool?.get)
        .mockResolvedValue(undefined);

      const updateUserStatsSpy = jest.spyOn(
        await import("../../../src/Aggregators/UserStatsPerPool"),
        "updateUserStatsPerPool",
      );

      await VeNFTLogic.updateNewOwnerUserStatsOnTransfer(
        mockTransferEvent,
        "0x2222222222222222222222222222222222222222",
        "0xpool1",
        50n,
        mockContext,
      );

      expect(updateUserStatsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalVeNFTamountStaked: 50n,
          lastActivityTimestamp: expect.any(Date),
        }),
        expect.any(Object),
        mockContext,
      );
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
