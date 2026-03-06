import type { MockInstance } from "vitest";
import type {
  UserStatsPerPool,
  VeNFTPoolVote,
  VeNFTState,
  VeNFT_DepositManaged_event,
  VeNFT_Deposit_event,
  VeNFT_Merge_event,
  VeNFT_Split_event,
  VeNFT_Transfer_event,
  VeNFT_WithdrawManaged_event,
  VeNFT_Withdraw_event,
  handlerContext,
} from "../../../generated";
import * as UserStatsPerPoolModule from "../../../src/Aggregators/UserStatsPerPool";
import * as VeNFTPoolVoteAggregator from "../../../src/Aggregators/VeNFTPoolVote";
import * as VeNFTStateAggregator from "../../../src/Aggregators/VeNFTState";
import {
  SECONDS_IN_A_WEEK,
  SECONDS_IN_FOUR_YEARS,
  VeNFTId,
  VeNFTPoolVoteId,
  toChecksumAddress,
} from "../../../src/Constants";
import * as VeNFTLogic from "../../../src/EventHandlers/VeNFT/VeNFTLogic";

describe("VeNFTLogic", () => {
  const mockVeNFTPoolVoteStore = {
    getWhere: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    set: vi.fn(),
  };

  const mockUserStatsStore = {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
  };

  const mockContext = {
    log: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    VeNFTPoolVote: mockVeNFTPoolVoteStore,
    UserStatsPerPool: mockUserStatsStore,
    UserStatsPerPoolSnapshot: { set: vi.fn() },
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
    lastSnapshotTimestamp: undefined,
  };

  const createMockDepositEvent = (): VeNFT_Deposit_event => ({
    params: {
      provider: toChecksumAddress("0x2222222222222222222222222222222222222222"),
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
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    transaction: {
      hash: "0x1111111111111111111111111111111111111111",
    },
  });

  describe("processVeNFTDeposit", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should call updateVeNFTState with the proper diff", async () => {
      const mockDepositEvent = createMockDepositEvent();
      const timestamp = new Date(mockDepositEvent.block.timestamp * 1000);
      const updateSpy = vi
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
        from: toChecksumAddress("0x1111111111111111111111111111111111111111"),
        to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
        tokenId: 1n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
      transaction: {
        hash: "0x1111111111111111111111111111111111111111",
      },
    } as VeNFT_Transfer_event;

    beforeEach(() => {
      vi.restoreAllMocks();
      vi.spyOn(VeNFTLogic, "reassignVeNFTVotesOnTransfer").mockResolvedValue(
        undefined,
      );
    });

    it("should update VeNFTState and reassign votes on transfer", async () => {
      const timestamp = new Date(mockTransferEvent.block.timestamp * 1000);
      const updateSpy = vi
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
          to: toChecksumAddress("0x0000000000000000000000000000000000000000"),
        },
      } as VeNFT_Transfer_event;
      const timestamp = new Date(burnEvent.block.timestamp * 1000);
      const updateSpy = vi
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTTransfer(
        burnEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(updateSpy).toHaveBeenCalledWith(
        {
          owner: toChecksumAddress(
            "0x0000000000000000000000000000000000000000",
          ),
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
        provider: toChecksumAddress(
          "0x1111111111111111111111111111111111111111",
        ),
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
      srcAddress: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
      transaction: {
        hash: "0x1111111111111111111111111111111111111111",
      },
    } as VeNFT_Withdraw_event;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should call updateVeNFTState with the proper diff", async () => {
      const timestamp = new Date(mockWithdrawEvent.block.timestamp * 1000);
      const updateSpy = vi
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

  describe("processVeNFTMerge", () => {
    it("reconciles source to zero and destination to the merged amount", async () => {
      const fromState = {
        ...mockVeNFTState,
        tokenId: 1n,
        totalValueLocked: 100n,
      };
      const toState = {
        ...mockVeNFTState,
        id: VeNFTId(10, 2n),
        tokenId: 2n,
        totalValueLocked: 40n,
      };
      const event = {
        params: {
          _sender: toChecksumAddress(
            "0x9999999999999999999999999999999999999999",
          ),
          _from: 1n,
          _to: 2n,
          _amountFrom: 100n,
          _amountTo: 40n,
          _amountFinal: 140n,
          _locktime: 500n,
          _ts: 200n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        transaction: { hash: "0xabcd" },
      } as VeNFT_Merge_event;
      const timestamp = new Date(event.block.timestamp * 1000);
      const updateSpy = vi
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTMerge(
        event,
        fromState,
        toState,
        mockContext,
      );

      expect(updateSpy).toHaveBeenNthCalledWith(
        1,
        {
          locktime: 0n,
          isAlive: false,
          incrementalTotalValueLocked: -100n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        fromState,
        timestamp,
        mockContext,
      );
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        {
          locktime: 500n,
          isAlive: true,
          incrementalTotalValueLocked: 100n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        toState,
        timestamp,
        mockContext,
      );
    });
  });

  describe("processVeNFTSplit", () => {
    it("reconciles the parent to zero and children to split amounts", async () => {
      const fromState = {
        ...mockVeNFTState,
        tokenId: 1n,
        totalValueLocked: 100n,
      };
      const token1State = {
        ...mockVeNFTState,
        id: VeNFTId(10, 2n),
        tokenId: 2n,
        totalValueLocked: 0n,
      };
      const token2State = {
        ...mockVeNFTState,
        id: VeNFTId(10, 3n),
        tokenId: 3n,
        totalValueLocked: 0n,
      };
      const event = {
        params: {
          _from: 1n,
          _tokenId1: 2n,
          _tokenId2: 3n,
          _sender: toChecksumAddress(
            "0x9999999999999999999999999999999999999999",
          ),
          _splitAmount1: 30n,
          _splitAmount2: 70n,
          _locktime: 700n,
          _ts: 200n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        transaction: { hash: "0xabcd" },
      } as VeNFT_Split_event;
      const timestamp = new Date(event.block.timestamp * 1000);
      const updateSpy = vi
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTSplit(
        event,
        fromState,
        token1State,
        token2State,
        mockContext,
      );

      expect(updateSpy).toHaveBeenNthCalledWith(
        1,
        {
          locktime: 0n,
          isAlive: false,
          incrementalTotalValueLocked: -100n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        fromState,
        timestamp,
        mockContext,
      );
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        {
          locktime: 700n,
          isAlive: true,
          incrementalTotalValueLocked: 30n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        token1State,
        timestamp,
        mockContext,
      );
      expect(updateSpy).toHaveBeenNthCalledWith(
        3,
        {
          locktime: 700n,
          isAlive: true,
          incrementalTotalValueLocked: 70n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        token2State,
        timestamp,
        mockContext,
      );
    });
  });

  describe("processVeNFTDepositManaged", () => {
    it("moves weight from the normal token into the managed token", async () => {
      const tokenState = {
        ...mockVeNFTState,
        tokenId: 1n,
        totalValueLocked: 80n,
      };
      const managedState = {
        ...mockVeNFTState,
        id: VeNFTId(10, 2n),
        tokenId: 2n,
        totalValueLocked: 200n,
      };
      const event = {
        params: {
          _owner: mockVeNFTState.owner,
          _tokenId: 1n,
          _mTokenId: 2n,
          _weight: 80n,
          _ts: 200n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        transaction: { hash: "0xabcd" },
      } as VeNFT_DepositManaged_event;
      const timestamp = new Date(event.block.timestamp * 1000);
      const updateSpy = vi
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTDepositManaged(
        event,
        tokenState,
        managedState,
        mockContext,
      );

      expect(updateSpy).toHaveBeenNthCalledWith(
        1,
        {
          locktime: undefined,
          isAlive: undefined,
          incrementalTotalValueLocked: -80n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        tokenState,
        timestamp,
        mockContext,
      );
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        {
          locktime: undefined,
          isAlive: undefined,
          incrementalTotalValueLocked: 80n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        managedState,
        timestamp,
        mockContext,
      );
    });
  });

  describe("processVeNFTWithdrawManaged", () => {
    it("restores weight to the normal token and reduces managed TVL", async () => {
      const tokenState = {
        ...mockVeNFTState,
        tokenId: 1n,
        totalValueLocked: 0n,
      };
      const managedState = {
        ...mockVeNFTState,
        id: VeNFTId(10, 2n),
        tokenId: 2n,
        totalValueLocked: 280n,
      };
      const event = {
        params: {
          _owner: mockVeNFTState.owner,
          _tokenId: 1n,
          _mTokenId: 2n,
          _weight: 80n,
          _ts: 123456n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        transaction: { hash: "0xabcd" },
      } as VeNFT_WithdrawManaged_event;
      const timestamp = new Date(event.block.timestamp * 1000);
      const expectedLocktime =
        ((123456n + SECONDS_IN_FOUR_YEARS) / SECONDS_IN_A_WEEK) *
        SECONDS_IN_A_WEEK;
      const updateSpy = vi
        .spyOn(VeNFTStateAggregator, "updateVeNFTState")
        .mockImplementation(() => {});

      await VeNFTLogic.processVeNFTWithdrawManaged(
        event,
        tokenState,
        managedState,
        mockContext,
      );

      expect(updateSpy).toHaveBeenNthCalledWith(
        1,
        {
          locktime: expectedLocktime,
          isAlive: true,
          incrementalTotalValueLocked: 80n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        tokenState,
        timestamp,
        mockContext,
      );
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        {
          locktime: undefined,
          isAlive: undefined,
          incrementalTotalValueLocked: -80n,
          lastUpdatedTimestamp: timestamp,
          owner: undefined,
        },
        managedState,
        timestamp,
        mockContext,
      );
    });
  });

  describe("reassignVeNFTVotesOnTransfer", () => {
    let loadPoolVotesSpy: MockInstance;

    const mockTransferEvent: VeNFT_Transfer_event = {
      params: {
        from: toChecksumAddress("0x1111111111111111111111111111111111111111"),
        to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
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
      loadPoolVotesSpy = vi.spyOn(
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
          params: {
            ...mockTransferEvent.params,
            to: sameOwnerState.owner as `0x${string}`,
          },
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

      vi.mocked(mockContext.VeNFTPoolVote?.getWhere).mockResolvedValue(
        poolVotes,
      );

      await VeNFTLogic.reassignVeNFTVotesOnTransfer(
        mockTransferEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(mockContext.VeNFTPoolVote?.getWhere).toHaveBeenCalledWith({
        veNFTState_id: { _eq: mockVeNFTState.id },
      });
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

      const getWhereMock = vi.mocked(mockContext.VeNFTPoolVote?.getWhere);
      getWhereMock.mockImplementation(() => Promise.resolve(poolVotes));

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
      vi.mocked(mockContext.UserStatsPerPool.get).mockImplementation(
        (id: string) =>
          Promise.resolve(
            id === previousOwnerId
              ? previousOwnerStats
              : id === newOwnerId
                ? newOwnerStats
                : undefined,
          ),
      );

      const updateUserStatsSpy = vi.spyOn(
        UserStatsPerPoolModule,
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
        new Date(mockTransferEvent.block.timestamp * 1000),
      );
      expect(updateUserStatsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalVeNFTamountStaked: 50n,
        }),
        newOwnerStats,
        mockContext,
        new Date(mockTransferEvent.block.timestamp * 1000),
      );
    });

    it("uses the pool vote chain id instead of the veNFT event chain id", async () => {
      const leafChainId = 252;
      const leafPoolAddress = "0xb43F6D14FeFA510F014cf90c8Ab110803bB28778";
      const oldOwnerId = `${leafChainId}-${mockVeNFTState.owner}-${leafPoolAddress}`;
      const newOwnerId = `${leafChainId}-${mockTransferEvent.params.to}-${leafPoolAddress}`;
      const poolVotes = [
        {
          id: VeNFTPoolVoteId(leafChainId, 1n, leafPoolAddress),
          poolAddress: leafPoolAddress,
          veNFTamountStaked: 50n,
          veNFTState_id: mockVeNFTState.id,
          lastUpdatedTimestamp: new Date(0),
        },
      ] as VeNFTPoolVote[];

      vi.mocked(mockContext.VeNFTPoolVote?.getWhere).mockResolvedValue(
        poolVotes,
      );

      const previousOwnerStats = {
        id: oldOwnerId,
        userAddress: mockVeNFTState.owner,
        poolAddress: leafPoolAddress,
        chainId: leafChainId,
        veNFTamountStaked: 50n,
        lastActivityTimestamp: new Date(0),
      } as UserStatsPerPool;
      const newOwnerStats = {
        id: newOwnerId,
        userAddress: mockTransferEvent.params.to,
        poolAddress: leafPoolAddress,
        chainId: leafChainId,
        veNFTamountStaked: 0n,
        lastActivityTimestamp: new Date(0),
      } as UserStatsPerPool;

      vi.mocked(mockContext.UserStatsPerPool?.get).mockImplementation(
        (id: string) =>
          Promise.resolve(
            id === oldOwnerId
              ? previousOwnerStats
              : id === newOwnerId
                ? newOwnerStats
                : undefined,
          ),
      );

      const updateUserStatsSpy = vi.spyOn(
        UserStatsPerPoolModule,
        "updateUserStatsPerPool",
      );

      await VeNFTLogic.reassignVeNFTVotesOnTransfer(
        mockTransferEvent,
        mockVeNFTState,
        mockContext,
      );

      expect(mockContext.UserStatsPerPool?.get).toHaveBeenCalledWith(
        oldOwnerId,
      );
      expect(updateUserStatsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalVeNFTamountStaked: -50n,
        }),
        previousOwnerStats,
        mockContext,
        new Date(mockTransferEvent.block.timestamp * 1000),
      );
      expect(updateUserStatsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalVeNFTamountStaked: 50n,
        }),
        newOwnerStats,
        mockContext,
        new Date(mockTransferEvent.block.timestamp * 1000),
      );
    });
  });

  describe("updatePreviousOwnerUserStatsOnTransfer", () => {
    const mockTransferEvent: VeNFT_Transfer_event = {
      params: {
        from: toChecksumAddress("0x1111111111111111111111111111111111111111"),
        to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
        tokenId: 1n,
      },
      block: { timestamp: 1000000, number: 1, hash: "0x" },
      chainId: 10,
      logIndex: 1,
      srcAddress: "0x",
      transaction: { hash: "0x" },
    } as VeNFT_Transfer_event;

    it("logs warn and skips update when previous owner UserStatsPerPool is missing", async () => {
      vi.mocked(mockContext.UserStatsPerPool?.get).mockResolvedValue(undefined);
      vi.mocked(mockContext.UserStatsPerPool?.set).mockClear();

      await VeNFTLogic.updatePreviousOwnerUserStatsOnTransfer(
        mockTransferEvent,
        toChecksumAddress("0x1111111111111111111111111111111111111111"),
        "0xpool1",
        10,
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
        userAddress: toChecksumAddress(
          "0x1111111111111111111111111111111111111111",
        ),
        poolAddress: "0xpool1",
        chainId: 10,
        veNFTamountStaked: 100n,
        lastActivityTimestamp: new Date(0),
      } as UserStatsPerPool;
      vi.mocked(mockContext.UserStatsPerPool?.get).mockResolvedValue(
        existingUserStats,
      );

      const updateUserStatsSpy = vi.spyOn(
        UserStatsPerPoolModule,
        "updateUserStatsPerPool",
      );

      await VeNFTLogic.updatePreviousOwnerUserStatsOnTransfer(
        mockTransferEvent,
        toChecksumAddress("0x1111111111111111111111111111111111111111"),
        "0xpool1",
        10,
        50n,
        mockContext,
      );

      expect(updateUserStatsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalVeNFTamountStaked: -50n,
        }),
        existingUserStats,
        mockContext,
        new Date(mockTransferEvent.block.timestamp * 1000),
      );
    });
  });

  describe("updateNewOwnerUserStatsOnTransfer", () => {
    const mockTransferEvent: VeNFT_Transfer_event = {
      params: {
        from: toChecksumAddress("0x1111111111111111111111111111111111111111"),
        to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
        tokenId: 1n,
      },
      block: { timestamp: 1000000, number: 1, hash: "0x" },
      chainId: 10,
      logIndex: 1,
      srcAddress: "0x",
      transaction: { hash: "0x" },
    } as VeNFT_Transfer_event;

    it("skips update when new owner is zero address (burn)", async () => {
      const loadOrCreateSpy = vi.spyOn(
        UserStatsPerPoolModule,
        "loadOrCreateUserData",
      );

      await VeNFTLogic.updateNewOwnerUserStatsOnTransfer(
        mockTransferEvent,
        toChecksumAddress("0x0000000000000000000000000000000000000000"),
        "0xpool1",
        10,
        50n,
        mockContext,
      );

      expect(loadOrCreateSpy).not.toHaveBeenCalled();
    });

    it("calls updateUserStatsPerPool with positive delta when new owner is not burn", async () => {
      vi.mocked(mockContext.UserStatsPerPool?.get).mockResolvedValue(undefined);

      const updateUserStatsSpy = vi.spyOn(
        UserStatsPerPoolModule,
        "updateUserStatsPerPool",
      );

      await VeNFTLogic.updateNewOwnerUserStatsOnTransfer(
        mockTransferEvent,
        toChecksumAddress("0x2222222222222222222222222222222222222222"),
        "0xpool1",
        10,
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
        new Date(mockTransferEvent.block.timestamp * 1000),
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
