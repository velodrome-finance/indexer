import { MockDb, VeNFT } from "../../generated/src/TestHelpers.gen";
import * as VeNFTAggregator from "../../src/Aggregators/VeNFTAggregator";
import * as VeNFTLogic from "../../src/EventHandlers/VeNFT/VeNFTLogic";

const VeNFTId = (chainId: number, tokenId: bigint) => `${chainId}_${tokenId}`;

describe("VeNFT Events", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  const chainId = 10;
  const tokenId = 1n;

  const mockVeNFTAggregator = {
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
    mockDb = mockDb.entities.VeNFTAggregator.set({ ...mockVeNFTAggregator });
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
        .spyOn(VeNFTAggregator, "updateVeNFTAggregator")
        .mockImplementation(() => {});
      jest.spyOn(VeNFTLogic, "processVeNFTEvent").mockResolvedValue({
        veNFTAggregatorDiff: {
          id: VeNFTId(chainId, tokenId),
          chainId: chainId,
          tokenId: tokenId,
          owner: eventData.to,
          locktime: mockVeNFTAggregator.locktime,
          totalValueLocked: mockVeNFTAggregator.totalValueLocked,
          isAlive: true,
        },
      });

      mockEvent = VeNFT.Transfer.createMockEvent(eventData);
      postEventDB = await VeNFT.Transfer.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should call processVeNFTEvent with the correct arguments", () => {
      const processVeNFTEventMock = jest.mocked(VeNFTLogic.processVeNFTEvent);
      expect(processVeNFTEventMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(processVeNFTEventMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      const calledWith = processVeNFTEventMock.mock.calls[0];
      expect(calledWith[0]).toEqual(mockEvent);
      expect(calledWith[1]).toEqual(mockVeNFTAggregator);
    });

    it("should call updateVeNFTAggregator with the correct arguments", () => {
      const updateVeNFTAggregatorMock = jest.mocked(
        VeNFTAggregator.updateVeNFTAggregator,
      );
      expect(updateVeNFTAggregatorMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(
        updateVeNFTAggregatorMock.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
      const calledWith = updateVeNFTAggregatorMock.mock.calls[0];
      expect(calledWith[0]).toEqual({
        id: VeNFTId(chainId, tokenId),
        chainId: chainId,
        tokenId: tokenId,
        owner: eventData.to,
        locktime: mockVeNFTAggregator.locktime,
        totalValueLocked: mockVeNFTAggregator.totalValueLocked,
        isAlive: true,
      });
      expect(calledWith[1]).toEqual(mockVeNFTAggregator);
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

    it("should create VeNFTAggregator entity when minting (from zero address)", async () => {
      const createdVeNFT = postEventDB.entities.VeNFTAggregator.get(
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
        .spyOn(VeNFTAggregator, "updateVeNFTAggregator")
        .mockImplementation(() => {});
      jest.spyOn(VeNFTLogic, "processVeNFTEvent").mockResolvedValue({
        veNFTAggregatorDiff: {
          id: VeNFTId(chainId, tokenId),
          chainId: chainId,
          tokenId: tokenId,
          owner: mockVeNFTAggregator.owner,
          locktime: mockVeNFTAggregator.locktime,
          totalValueLocked: -eventData.value,
          isAlive: false, // Withdraw is a burn operation
        },
      });

      mockEvent = VeNFT.Withdraw.createMockEvent(eventData);
      postEventDB = await VeNFT.Withdraw.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should call processVeNFTEvent with the correct arguments", () => {
      const processVeNFTEventMock = jest.mocked(VeNFTLogic.processVeNFTEvent);
      expect(processVeNFTEventMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(processVeNFTEventMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      const calledWith = processVeNFTEventMock.mock.calls[0];
      expect(calledWith[0]).toEqual(mockEvent);
      expect(calledWith[1]).toEqual(mockVeNFTAggregator);
    });

    it("should call updateVeNFTAggregator with the correct arguments", () => {
      const updateVeNFTAggregatorMock = jest.mocked(
        VeNFTAggregator.updateVeNFTAggregator,
      );
      expect(updateVeNFTAggregatorMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(
        updateVeNFTAggregatorMock.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
      const calledWith = updateVeNFTAggregatorMock.mock.calls[0];
      expect(calledWith[0]).toEqual({
        id: VeNFTId(chainId, tokenId),
        chainId: chainId,
        tokenId: tokenId,
        owner: mockVeNFTAggregator.owner,
        locktime: mockVeNFTAggregator.locktime,
        totalValueLocked: -eventData.value,
        isAlive: false, // Withdraw is a burn operation
      });
      expect(calledWith[1]).toEqual(mockVeNFTAggregator);
      expect(calledWith[2]).toEqual(new Date(mockEvent.block.timestamp * 1000));
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
        .spyOn(VeNFTAggregator, "updateVeNFTAggregator")
        .mockImplementation(() => {});
      jest.spyOn(VeNFTLogic, "processVeNFTEvent").mockResolvedValue({
        veNFTAggregatorDiff: {
          id: VeNFTId(chainId, tokenId),
          chainId: chainId,
          tokenId: tokenId,
          owner: eventData.provider,
          locktime: eventData.locktime,
          totalValueLocked: eventData.value,
          isAlive: true,
        },
      });

      mockEvent = VeNFT.Deposit.createMockEvent(eventData);
      postEventDB = await VeNFT.Deposit.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should call processVeNFTEvent with the correct arguments", () => {
      const processVeNFTEventMock = jest.mocked(VeNFTLogic.processVeNFTEvent);
      expect(processVeNFTEventMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(processVeNFTEventMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      const calledWith = processVeNFTEventMock.mock.calls[0];
      expect(calledWith[0]).toEqual(mockEvent);
      expect(calledWith[1]).toEqual(mockVeNFTAggregator);
    });

    it("should call updateVeNFTAggregator with the correct arguments", () => {
      const updateVeNFTAggregatorMock = jest.mocked(
        VeNFTAggregator.updateVeNFTAggregator,
      );
      expect(updateVeNFTAggregatorMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(
        updateVeNFTAggregatorMock.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
      const calledWith = updateVeNFTAggregatorMock.mock.calls[0];
      expect(calledWith[0]).toEqual({
        id: VeNFTId(chainId, tokenId),
        chainId: chainId,
        tokenId: tokenId,
        owner: eventData.provider,
        locktime: eventData.locktime,
        totalValueLocked: eventData.value,
        isAlive: true,
      });
      expect(calledWith[1]).toEqual(mockVeNFTAggregator);
      expect(calledWith[2]).toEqual(new Date(mockEvent.block.timestamp * 1000));
    });
  });
});
