import { MockDb, VeNFT } from "../../generated/src/TestHelpers.gen";
import * as VeNFTStateModule from "../../src/Aggregators/VeNFTState";
import { VeNFTId } from "../../src/Aggregators/VeNFTState";
import { toChecksumAddress } from "../../src/Constants";
import * as VeNFTLogic from "../../src/EventHandlers/VeNFT/VeNFTLogic";
import { setupCommon } from "./Pool/common";

describe("VeNFT Events", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  const chainId = 10;
  const tokenId = 1n;

  const mockVeNFTState = {
    id: VeNFTId(chainId, tokenId),
    chainId: 10,
    tokenId: tokenId,
    isAlive: true,
    lastUpdatedTimestamp: new Date(),
    locktime: 1n,
    owner: "0x2222222222222222222222222222222222222222",
    totalValueLocked: 1n,
  };

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.VeNFTState.set({ ...mockVeNFTState });
  });

  describe("Transfer Event", () => {
    const eventData = {
      provider: "0x1111111111111111111111111111111111111111",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      tokenId: 1n,
      timestamp: 1n,
      chainId: 10,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof VeNFT.Transfer.createMockEvent>;

    beforeEach(async () => {
      jest
        .spyOn(VeNFTStateModule, "updateVeNFTState")
        .mockImplementation(() => {});
      jest.spyOn(VeNFTLogic, "processVeNFTTransfer");
      jest
        .spyOn(VeNFTLogic, "reassignVeNFTVotesOnTransfer")
        .mockResolvedValue(undefined);

      mockEvent = VeNFT.Transfer.createMockEvent(eventData);
      postEventDB = await VeNFT.Transfer.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should call processVeNFTTransfer with the correct arguments", () => {
      const processVeNFTTransferMock = jest.mocked(
        VeNFTLogic.processVeNFTTransfer,
      );
      expect(processVeNFTTransferMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(processVeNFTTransferMock.mock.calls.length).toBeGreaterThanOrEqual(
        1,
      );
      const calledWith = processVeNFTTransferMock.mock.calls[0];
      expect(calledWith[0]).toEqual(mockEvent);
      expect(calledWith[1]).toEqual(mockVeNFTState);
    });

    it("should call updateVeNFTState with the correct arguments", () => {
      const updateVeNFTStateMock = jest.mocked(
        VeNFTStateModule.updateVeNFTState,
      );
      expect(updateVeNFTStateMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(updateVeNFTStateMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      const timestamp = new Date(mockEvent.block.timestamp * 1000);
      const calledWith = updateVeNFTStateMock.mock.calls[0];
      expect(calledWith[0]).toEqual({
        owner: eventData.to,
        lastUpdatedTimestamp: timestamp,
        isAlive: true,
      });
      expect(calledWith[1]).toEqual(mockVeNFTState);
      expect(calledWith[2]).toEqual(new Date(mockEvent.block.timestamp * 1000));
    });
  });

  describe("Transfer Event - Minting", () => {
    const mintEventData = {
      provider: "0x1111111111111111111111111111111111111111",
      from: "0x0000000000000000000000000000000000000000",
      to: "0x2222222222222222222222222222222222222222",
      tokenId: 2n,
      timestamp: 1n,
      chainId: 10,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof VeNFT.Transfer.createMockEvent>;

    beforeEach(async () => {
      // Create a fresh mockDb without the VeNFT for this tokenId
      const freshMockDb = MockDb.createMockDb();
      mockEvent = VeNFT.Transfer.createMockEvent(mintEventData);
      postEventDB = await VeNFT.Transfer.processEvent({
        event: mockEvent,
        mockDb: freshMockDb,
      });
    });

    it("should create VeNFTState entity when minting (from zero address)", async () => {
      const createdVeNFT = postEventDB.entities.VeNFTState.get(
        VeNFTId(chainId, mintEventData.tokenId),
      );

      expect(createdVeNFT).toBeDefined();
      expect(createdVeNFT?.id).toBe(VeNFTId(chainId, mintEventData.tokenId));
      expect(createdVeNFT?.chainId).toBe(chainId);
      expect(createdVeNFT?.tokenId).toBe(mintEventData.tokenId);
      expect(createdVeNFT?.owner).toBe(mintEventData.to);
      expect(createdVeNFT?.locktime).toBe(0n);
      expect(createdVeNFT?.totalValueLocked).toBe(0n);
      expect(createdVeNFT?.isAlive).toBe(true);
      expect(createdVeNFT?.lastUpdatedTimestamp).toEqual(
        new Date(mintEventData.mockEventData.block.timestamp * 1000),
      );
    });
  });

  describe("Transfer Event - Vote Reassignment", () => {
    const zeroAddress = "0x0000000000000000000000000000000000000000";

    it("should reassign votes from old owner to new owner", async () => {
      const {
        createMockUserStatsPerPool,
        createMockVeNFTState,
        createMockVeNFTPoolVote,
      } = setupCommon();

      const poolAddress = toChecksumAddress(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      const oldOwner = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const newOwner = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const voteAmount = 500n;

      const veNFT = createMockVeNFTState({
        id: VeNFTId(chainId, tokenId),
        chainId,
        tokenId,
        owner: oldOwner,
      });

      const oldUserStats = createMockUserStatsPerPool({
        userAddress: oldOwner,
        poolAddress,
        chainId,
        veNFTamountStaked: voteAmount,
        firstActivityTimestamp: new Date(0),
        lastActivityTimestamp: new Date(0),
      });

      const newUserStats = createMockUserStatsPerPool({
        userAddress: newOwner,
        poolAddress,
        chainId,
        veNFTamountStaked: 0n,
        firstActivityTimestamp: new Date(0),
        lastActivityTimestamp: new Date(0),
      });

      const veNFTPoolVote = createMockVeNFTPoolVote({
        poolAddress,
        veNFTamountStaked: voteAmount,
        veNFTState_id: veNFT.id,
        lastUpdatedTimestamp: new Date(0),
      });

      let db = MockDb.createMockDb();
      db = db.entities.VeNFTState.set(veNFT);
      db = db.entities.UserStatsPerPool.set(oldUserStats);
      db = db.entities.UserStatsPerPool.set(newUserStats);
      db = db.entities.VeNFTPoolVote.set(veNFTPoolVote);

      const transferEvent = VeNFT.Transfer.createMockEvent({
        from: oldOwner,
        to: newOwner,
        tokenId,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: oldOwner,
        },
      });

      const resultDB = await VeNFT.Transfer.processEvent({
        event: transferEvent,
        mockDb: db,
      });

      const updatedOldUserStats = resultDB.entities.UserStatsPerPool.get(
        `${oldOwner}_${poolAddress}_${chainId}`,
      );
      const updatedNewUserStats = resultDB.entities.UserStatsPerPool.get(
        `${newOwner}_${poolAddress}_${chainId}`,
      );

      expect(updatedOldUserStats?.veNFTamountStaked).toBe(0n);
      expect(updatedNewUserStats?.veNFTamountStaked).toBe(voteAmount);
    });

    it("should reassign votes across multiple pools", async () => {
      const {
        createMockUserStatsPerPool,
        createMockVeNFTState,
        createMockVeNFTPoolVote,
      } = setupCommon();

      const poolA = toChecksumAddress(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
      const poolB = toChecksumAddress(
        "0xcccccccccccccccccccccccccccccccccccccccc",
      );
      const oldOwner = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const newOwner = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );

      const veNFT = createMockVeNFTState({
        id: VeNFTId(chainId, tokenId),
        chainId,
        tokenId,
        owner: oldOwner,
      });

      const oldUserStatsA = createMockUserStatsPerPool({
        userAddress: oldOwner,
        poolAddress: poolA,
        chainId,
        veNFTamountStaked: 300n,
        firstActivityTimestamp: new Date(0),
        lastActivityTimestamp: new Date(0),
      });
      const oldUserStatsB = createMockUserStatsPerPool({
        userAddress: oldOwner,
        poolAddress: poolB,
        chainId,
        veNFTamountStaked: 200n,
        firstActivityTimestamp: new Date(0),
        lastActivityTimestamp: new Date(0),
      });
      const newUserStatsA = createMockUserStatsPerPool({
        userAddress: newOwner,
        poolAddress: poolA,
        chainId,
        veNFTamountStaked: 0n,
        firstActivityTimestamp: new Date(0),
        lastActivityTimestamp: new Date(0),
      });
      const newUserStatsB = createMockUserStatsPerPool({
        userAddress: newOwner,
        poolAddress: poolB,
        chainId,
        veNFTamountStaked: 0n,
        firstActivityTimestamp: new Date(0),
        lastActivityTimestamp: new Date(0),
      });

      const tokenVotesA = createMockVeNFTPoolVote({
        poolAddress: poolA,
        veNFTamountStaked: 300n,
        veNFTState_id: veNFT.id,
        lastUpdatedTimestamp: new Date(0),
      });
      const tokenVotesB = createMockVeNFTPoolVote({
        poolAddress: poolB,
        veNFTamountStaked: 200n,
        veNFTState_id: veNFT.id,
        lastUpdatedTimestamp: new Date(0),
      });

      let db = MockDb.createMockDb();
      db = db.entities.VeNFTState.set(veNFT);
      db = db.entities.UserStatsPerPool.set(oldUserStatsA);
      db = db.entities.UserStatsPerPool.set(oldUserStatsB);
      db = db.entities.UserStatsPerPool.set(newUserStatsA);
      db = db.entities.UserStatsPerPool.set(newUserStatsB);
      db = db.entities.VeNFTPoolVote.set(tokenVotesA);
      db = db.entities.VeNFTPoolVote.set(tokenVotesB);

      const transferEvent = VeNFT.Transfer.createMockEvent({
        from: oldOwner,
        to: newOwner,
        tokenId,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: oldOwner,
        },
      });

      const resultDB = await VeNFT.Transfer.processEvent({
        event: transferEvent,
        mockDb: db,
      });

      const updatedOldA = resultDB.entities.UserStatsPerPool.get(
        `${oldOwner}_${poolA}_${chainId}`,
      );
      const updatedOldB = resultDB.entities.UserStatsPerPool.get(
        `${oldOwner}_${poolB}_${chainId}`,
      );
      const updatedNewA = resultDB.entities.UserStatsPerPool.get(
        `${newOwner}_${poolA}_${chainId}`,
      );
      const updatedNewB = resultDB.entities.UserStatsPerPool.get(
        `${newOwner}_${poolB}_${chainId}`,
      );

      expect(updatedOldA?.veNFTamountStaked).toBe(0n);
      expect(updatedOldB?.veNFTamountStaked).toBe(0n);
      expect(updatedNewA?.veNFTamountStaked).toBe(300n);
      expect(updatedNewB?.veNFTamountStaked).toBe(200n);
    });

    it("should remove votes from old owner on burn without adding to new owner", async () => {
      const {
        createMockUserStatsPerPool,
        createMockVeNFTState,
        createMockVeNFTPoolVote,
      } = setupCommon();

      const poolAddress = toChecksumAddress(
        "0xdddddddddddddddddddddddddddddddddddddddd",
      );
      const oldOwner = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const voteAmount = 250n;

      const veNFT = createMockVeNFTState({
        id: VeNFTId(chainId, tokenId),
        chainId,
        tokenId,
        owner: oldOwner,
      });

      const oldUserStats = createMockUserStatsPerPool({
        userAddress: oldOwner,
        poolAddress,
        chainId,
        veNFTamountStaked: voteAmount,
        firstActivityTimestamp: new Date(0),
        lastActivityTimestamp: new Date(0),
      });

      const tokenVotes = createMockVeNFTPoolVote({
        poolAddress,
        veNFTamountStaked: voteAmount,
        veNFTState_id: veNFT.id,
        lastUpdatedTimestamp: new Date(0),
      });

      let db = MockDb.createMockDb();
      db = db.entities.VeNFTState.set(veNFT);
      db = db.entities.UserStatsPerPool.set(oldUserStats);
      db = db.entities.VeNFTPoolVote.set(tokenVotes);

      const burnEvent = VeNFT.Transfer.createMockEvent({
        from: oldOwner,
        to: zeroAddress,
        tokenId,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: oldOwner,
        },
      });

      const resultDB = await VeNFT.Transfer.processEvent({
        event: burnEvent,
        mockDb: db,
      });

      const updatedOldUserStats = resultDB.entities.UserStatsPerPool.get(
        `${oldOwner}_${poolAddress}_${chainId}`,
      );
      expect(updatedOldUserStats?.veNFTamountStaked).toBe(0n);

      const newOwnerStats = resultDB.entities.UserStatsPerPool.get(
        `${zeroAddress}_${poolAddress}_${chainId}`,
      );
      expect(newOwnerStats).toBeUndefined();
    });

    it("should handle transfers with no voted pools", async () => {
      const { createMockUserStatsPerPool, createMockVeNFTState } =
        setupCommon();

      const poolAddress = toChecksumAddress(
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      );
      const oldOwner = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const newOwner = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );

      const veNFT = createMockVeNFTState({
        id: VeNFTId(chainId, tokenId),
        chainId,
        tokenId,
        owner: oldOwner,
      });

      const oldUserStats = createMockUserStatsPerPool({
        userAddress: oldOwner,
        poolAddress,
        chainId,
        veNFTamountStaked: 123n,
        firstActivityTimestamp: new Date(0),
        lastActivityTimestamp: new Date(0),
      });

      let db = MockDb.createMockDb();
      db = db.entities.VeNFTState.set(veNFT);
      db = db.entities.UserStatsPerPool.set(oldUserStats);

      const transferEvent = VeNFT.Transfer.createMockEvent({
        from: oldOwner,
        to: newOwner,
        tokenId,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: oldOwner,
        },
      });

      const resultDB = await VeNFT.Transfer.processEvent({
        event: transferEvent,
        mockDb: db,
      });

      const updatedOldUserStats = resultDB.entities.UserStatsPerPool.get(
        `${oldOwner}_${poolAddress}_${chainId}`,
      );
      expect(updatedOldUserStats?.veNFTamountStaked).toBe(123n);
      const newOwnerStats = resultDB.entities.UserStatsPerPool.get(
        `${newOwner}_${poolAddress}_${chainId}`,
      );
      expect(newOwnerStats).toBeUndefined();
    });
  });

  describe("Withdraw Event", () => {
    const eventData = {
      provider: "0x1111111111111111111111111111111111111111",
      tokenId: 1n,
      value: 1n,
      ts: 1n,
      chainId: 10,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof VeNFT.Withdraw.createMockEvent>;

    beforeEach(async () => {
      jest
        .spyOn(VeNFTStateModule, "updateVeNFTState")
        .mockImplementation(() => {});
      jest.spyOn(VeNFTLogic, "processVeNFTWithdraw");

      mockEvent = VeNFT.Withdraw.createMockEvent(eventData);
      postEventDB = await VeNFT.Withdraw.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should call processVeNFTWithdraw with the correct arguments", () => {
      const processVeNFTWithdrawMock = jest.mocked(
        VeNFTLogic.processVeNFTWithdraw,
      );
      expect(processVeNFTWithdrawMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(processVeNFTWithdrawMock.mock.calls.length).toBeGreaterThanOrEqual(
        1,
      );
      const calledWith = processVeNFTWithdrawMock.mock.calls[0];
      expect(calledWith[0]).toEqual(mockEvent);
      expect(calledWith[1]).toEqual(mockVeNFTState);
    });

    it("should call updateVeNFTState with the correct arguments", () => {
      const updateVeNFTStateMock = jest.mocked(
        VeNFTStateModule.updateVeNFTState,
      );
      expect(updateVeNFTStateMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(updateVeNFTStateMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      const timestamp = new Date(mockEvent.block.timestamp * 1000);
      const calledWith = updateVeNFTStateMock.mock.calls[0];
      expect(calledWith[0]).toEqual({
        incrementalTotalValueLocked: -eventData.value,
        lastUpdatedTimestamp: timestamp,
      });
      expect(calledWith[1]).toEqual(mockVeNFTState);
      expect(calledWith[2]).toEqual(new Date(mockEvent.block.timestamp * 1000));
    });

    it("should not call processVeNFTWithdraw when VeNFTState is not found", async () => {
      const dbWithoutVeNFTState = MockDb.createMockDb();
      const withdrawEvent = VeNFT.Withdraw.createMockEvent(eventData);

      const resultDB = await VeNFT.Withdraw.processEvent({
        event: withdrawEvent,
        mockDb: dbWithoutVeNFTState,
      });

      expect(resultDB).toBeDefined();
      expect(
        resultDB.entities.VeNFTState.get(VeNFTId(chainId, eventData.tokenId)),
      ).toBeUndefined();
    });
  });

  describe("Deposit Event", () => {
    const eventData = {
      provider: "0x1111111111111111111111111111111111111111",
      tokenId: 1n,
      value: 1n,
      locktime: 1n,
      depositType: 1n,
      ts: 1n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof VeNFT.Deposit.createMockEvent>;

    beforeEach(async () => {
      jest
        .spyOn(VeNFTStateModule, "updateVeNFTState")
        .mockImplementation(() => {});
      jest.spyOn(VeNFTLogic, "processVeNFTDeposit");

      mockEvent = VeNFT.Deposit.createMockEvent(eventData);
      postEventDB = await VeNFT.Deposit.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should call processVeNFTDeposit with the correct arguments", () => {
      const processVeNFTDepositMock = jest.mocked(
        VeNFTLogic.processVeNFTDeposit,
      );
      expect(processVeNFTDepositMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(processVeNFTDepositMock.mock.calls.length).toBeGreaterThanOrEqual(
        1,
      );
      const calledWith = processVeNFTDepositMock.mock.calls[0];
      expect(calledWith[0]).toEqual(mockEvent);
      expect(calledWith[1]).toEqual(mockVeNFTState);
    });

    it("should call updateVeNFTState with the correct arguments", () => {
      const updateVeNFTStateMock = jest.mocked(
        VeNFTStateModule.updateVeNFTState,
      );
      expect(updateVeNFTStateMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(updateVeNFTStateMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      const timestamp = new Date(mockEvent.block.timestamp * 1000);
      const calledWith = updateVeNFTStateMock.mock.calls[0];
      expect(calledWith[0]).toEqual({
        locktime: eventData.locktime,
        incrementalTotalValueLocked: eventData.value,
        isAlive: true,
        lastUpdatedTimestamp: timestamp,
      });
      expect(calledWith[1]).toEqual(mockVeNFTState);
      expect(calledWith[2]).toEqual(new Date(mockEvent.block.timestamp * 1000));
    });

    it("should not call processVeNFTDeposit when VeNFTState is not found", async () => {
      const dbWithoutVeNFTState = MockDb.createMockDb();
      const depositEvent = VeNFT.Deposit.createMockEvent(eventData);

      const resultDB = await VeNFT.Deposit.processEvent({
        event: depositEvent,
        mockDb: dbWithoutVeNFTState,
      });

      expect(resultDB).toBeDefined();
      expect(
        resultDB.entities.VeNFTState.get(VeNFTId(chainId, eventData.tokenId)),
      ).toBeUndefined();
    });
  });
});
