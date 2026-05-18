import { createTestIndexer } from "envio";
import * as VeNFTStateModule from "../../src/Aggregators/VeNFTState";
import {
  SECONDS_IN_A_WEEK,
  SECONDS_IN_FOUR_YEARS,
  UserStatsPerPoolId,
  VeNFTId,
  toChecksumAddress,
} from "../../src/Constants";
import * as VeNFTLogic from "../../src/EventHandlers/VeNFT/VeNFTLogic";
import { simulateEvent } from "../testHelpers";
import { setupCommon } from "./Pool/common";

describe("VeNFT Events", () => {
  const chainId = 10;
  const tokenId = 1n;

  const mockVeNFTState = {
    id: VeNFTId(chainId, tokenId),
    chainId: 10,
    tokenId: tokenId,
    isAlive: true,
    lastUpdatedTimestamp: new Date(),
    locktime: 1n,
    isPermanent: false,
    owner: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    totalValueLocked: 1n,
    lastSnapshotTimestamp: undefined as Date | undefined,
  };

  describe("Transfer Event", () => {
    const eventData = {
      provider: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      from: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      tokenId: 1n,
      timestamp: 1n,
      chainId: 10,
    };

    const block = {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };
    const srcAddress = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );

    beforeEach(async () => {
      vi.spyOn(VeNFTStateModule, "updateVeNFTState").mockResolvedValue(
        undefined,
      );
      vi.spyOn(VeNFTLogic, "processVeNFTTransfer");
      vi.spyOn(VeNFTLogic, "reassignVeNFTVotesOnTransfer").mockResolvedValue(
        undefined,
      );

      const indexer = createTestIndexer();
      indexer.VeNFTState.set({ ...mockVeNFTState });
      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Transfer",
        params: eventData,
        block,
        srcAddress,
        logIndex: 1,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // TODO V3 migration: vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call processVeNFTTransfer with the correct arguments", () => {
      const processVeNFTTransferMock = vi.mocked(
        VeNFTLogic.processVeNFTTransfer,
      );
      expect(processVeNFTTransferMock).toHaveBeenCalled();
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(processVeNFTTransferMock.mock.calls.length).toBeGreaterThanOrEqual(
        1,
      );
    });

    // TODO V3 migration: vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call updateVeNFTState with the correct arguments", () => {
      const updateVeNFTStateMock = vi.mocked(VeNFTStateModule.updateVeNFTState);
      expect(updateVeNFTStateMock).toHaveBeenCalled();
    });
  });

  describe("Transfer Event - Minting", () => {
    const mintEventData = {
      from: toChecksumAddress("0x0000000000000000000000000000000000000000"),
      to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      tokenId: 2n,
    };

    const mintBlock = {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    it("should create VeNFTState entity when minting (from zero address)", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Transfer",
        params: mintEventData,
        block: mintBlock,
        srcAddress: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        logIndex: 1,
      });

      const createdVeNFT = await indexer.VeNFTState.get(
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
      expect(
        new Date(
          createdVeNFT?.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(mintBlock.timestamp * 1000);
    });
  });

  describe("Transfer Event - Vote Reassignment", () => {
    const zeroAddress = toChecksumAddress(
      "0x0000000000000000000000000000000000000000",
    );

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

      const indexer = createTestIndexer();
      indexer.VeNFTState.set(veNFT);
      indexer.UserStatsPerPool.set(oldUserStats);
      indexer.UserStatsPerPool.set(newUserStats);
      indexer.VeNFTPoolVote.set(veNFTPoolVote);

      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Transfer",
        params: { from: oldOwner, to: newOwner, tokenId },
        block: { timestamp: 1000000, number: 123456, hash: "0xhash" },
        srcAddress: oldOwner,
        logIndex: 1,
      });

      const updatedOldUserStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolAddress),
      );
      const updatedNewUserStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, newOwner, poolAddress),
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

      const indexer = createTestIndexer();
      indexer.VeNFTState.set(veNFT);
      indexer.UserStatsPerPool.set(oldUserStatsA);
      indexer.UserStatsPerPool.set(oldUserStatsB);
      indexer.UserStatsPerPool.set(newUserStatsA);
      indexer.UserStatsPerPool.set(newUserStatsB);
      indexer.VeNFTPoolVote.set(tokenVotesA);
      indexer.VeNFTPoolVote.set(tokenVotesB);

      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Transfer",
        params: { from: oldOwner, to: newOwner, tokenId },
        block: { timestamp: 1000000, number: 123456, hash: "0xhash" },
        srcAddress: oldOwner,
        logIndex: 1,
      });

      const updatedOldA = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolA),
      );
      const updatedOldB = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolB),
      );
      const updatedNewA = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, newOwner, poolA),
      );
      const updatedNewB = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, newOwner, poolB),
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

      const indexer = createTestIndexer();
      indexer.VeNFTState.set(veNFT);
      indexer.UserStatsPerPool.set(oldUserStats);
      indexer.VeNFTPoolVote.set(tokenVotes);

      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Transfer",
        params: { from: oldOwner, to: zeroAddress, tokenId },
        block: { timestamp: 1000000, number: 123456, hash: "0xhash" },
        srcAddress: oldOwner,
        logIndex: 1,
      });

      const updatedOldUserStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolAddress),
      );
      expect(updatedOldUserStats?.veNFTamountStaked).toBe(0n);

      const newOwnerStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, zeroAddress, poolAddress),
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

      const indexer = createTestIndexer();
      indexer.VeNFTState.set(veNFT);
      indexer.UserStatsPerPool.set(oldUserStats);

      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Transfer",
        params: { from: oldOwner, to: newOwner, tokenId },
        block: { timestamp: 1000000, number: 123456, hash: "0xhash" },
        srcAddress: oldOwner,
        logIndex: 1,
      });

      const updatedOldUserStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolAddress),
      );
      expect(updatedOldUserStats?.veNFTamountStaked).toBe(123n);
      const newOwnerStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, newOwner, poolAddress),
      );
      expect(newOwnerStats).toBeUndefined();
    });
  });

  describe("Withdraw Event", () => {
    const eventData = {
      provider: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      tokenId: 1n,
      value: 1n,
      ts: 1n,
    };

    const block = {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };
    const srcAddress = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );

    beforeEach(async () => {
      vi.spyOn(VeNFTStateModule, "updateVeNFTState").mockResolvedValue(
        undefined,
      );
      vi.spyOn(VeNFTLogic, "processVeNFTWithdraw");

      const indexer = createTestIndexer();
      indexer.VeNFTState.set({ ...mockVeNFTState });
      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Withdraw",
        params: eventData,
        block,
        srcAddress,
        logIndex: 1,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // TODO V3 migration: vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call processVeNFTWithdraw with the correct arguments", () => {
      const processVeNFTWithdrawMock = vi.mocked(
        VeNFTLogic.processVeNFTWithdraw,
      );
      expect(processVeNFTWithdrawMock).toHaveBeenCalled();
    });

    // TODO V3 migration: vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call updateVeNFTState with the correct arguments", () => {
      const updateVeNFTStateMock = vi.mocked(VeNFTStateModule.updateVeNFTState);
      expect(updateVeNFTStateMock).toHaveBeenCalled();
    });

    it("should not call processVeNFTWithdraw when VeNFTState is not found", async () => {
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Withdraw",
        params: eventData,
        block,
        srcAddress,
        logIndex: 1,
      });

      const veNFT = await indexer.VeNFTState.get(
        VeNFTId(chainId, eventData.tokenId),
      );
      expect(veNFT).toBeUndefined();
    });
  });

  describe("Deposit Event", () => {
    const eventData = {
      provider: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      tokenId: 1n,
      value: 1n,
      locktime: 1n,
      depositType: 1n,
      ts: 1n,
    };

    const block = {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };
    const srcAddress = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );

    beforeEach(async () => {
      vi.spyOn(VeNFTStateModule, "updateVeNFTState").mockResolvedValue(
        undefined,
      );
      vi.spyOn(VeNFTLogic, "processVeNFTDeposit");

      const indexer = createTestIndexer();
      indexer.VeNFTState.set({ ...mockVeNFTState });
      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Deposit",
        params: eventData,
        block,
        srcAddress,
        logIndex: 1,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // TODO V3 migration: vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call processVeNFTDeposit with the correct arguments", () => {
      const processVeNFTDepositMock = vi.mocked(VeNFTLogic.processVeNFTDeposit);
      expect(processVeNFTDepositMock).toHaveBeenCalled();
    });

    // TODO V3 migration: vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call updateVeNFTState with the correct arguments", () => {
      const updateVeNFTStateMock = vi.mocked(VeNFTStateModule.updateVeNFTState);
      expect(updateVeNFTStateMock).toHaveBeenCalled();
    });

    it("should not call processVeNFTDeposit when VeNFTState is not found", async () => {
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "VeNFT",
        event: "Deposit",
        params: eventData,
        block,
        srcAddress,
        logIndex: 1,
      });

      const veNFT = await indexer.VeNFTState.get(
        VeNFTId(chainId, eventData.tokenId),
      );
      expect(veNFT).toBeUndefined();
    });
  });

  describe("Split Flow Regression", () => {
    it("reconciles child TVL before withdraw so it does not go negative", async () => {
      const owner = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const indexer = createTestIndexer();
      indexer.VeNFTState.set({
        ...mockVeNFTState,
        id: VeNFTId(chainId, 11n),
        tokenId: 11n,
        owner,
        locktime: 999n,
        totalValueLocked: 100n,
      });

      const mockEventData = (logIndex: number) => ({
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0xsplit",
        },
        srcAddress: owner,
        logIndex,
      });

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                params: {
                  from: owner,
                  to: toChecksumAddress(
                    "0x0000000000000000000000000000000000000000",
                  ),
                  tokenId: 11n,
                },
                ...mockEventData(1),
              },
              {
                contract: "VeNFT",
                event: "Transfer",
                params: {
                  from: toChecksumAddress(
                    "0x0000000000000000000000000000000000000000",
                  ),
                  to: owner,
                  tokenId: 12n,
                },
                ...mockEventData(2),
              },
              {
                contract: "VeNFT",
                event: "Transfer",
                params: {
                  from: toChecksumAddress(
                    "0x0000000000000000000000000000000000000000",
                  ),
                  to: owner,
                  tokenId: 13n,
                },
                ...mockEventData(3),
              },
              {
                contract: "VeNFT",
                event: "Split",
                params: {
                  _from: 11n,
                  _tokenId1: 12n,
                  _tokenId2: 13n,
                  _sender: owner,
                  _splitAmount1: 30n,
                  _splitAmount2: 70n,
                  _locktime: 777n,
                  _ts: 555n,
                },
                ...mockEventData(4),
              },
              {
                contract: "VeNFT",
                event: "Withdraw",
                params: {
                  provider: owner,
                  tokenId: 12n,
                  value: 30n,
                  ts: 556n,
                },
                ...mockEventData(5),
              },
            ],
          },
        },
      });

      expect(
        (await indexer.VeNFTState.get(VeNFTId(chainId, 11n)))?.totalValueLocked,
      ).toBe(0n);
      expect(
        (await indexer.VeNFTState.get(VeNFTId(chainId, 12n)))?.totalValueLocked,
      ).toBe(0n);
      expect(
        (await indexer.VeNFTState.get(VeNFTId(chainId, 13n)))?.totalValueLocked,
      ).toBe(70n);
    });
  });

  describe("Merge Flow Regression", () => {
    it("reconciles destination TVL before withdraw so it does not go negative", async () => {
      const owner = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const indexer = createTestIndexer();
      indexer.VeNFTState.set({
        ...mockVeNFTState,
        id: VeNFTId(chainId, 21n),
        tokenId: 21n,
        owner,
        locktime: 999n,
        totalValueLocked: 100n,
      });
      indexer.VeNFTState.set({
        ...mockVeNFTState,
        id: VeNFTId(chainId, 22n),
        tokenId: 22n,
        owner,
        locktime: 999n,
        totalValueLocked: 40n,
      });

      const mockEventData = (logIndex: number) => ({
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0xmerge",
        },
        srcAddress: owner,
        logIndex,
      });

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                params: {
                  from: owner,
                  to: toChecksumAddress(
                    "0x0000000000000000000000000000000000000000",
                  ),
                  tokenId: 21n,
                },
                ...mockEventData(1),
              },
              {
                contract: "VeNFT",
                event: "Merge",
                params: {
                  _sender: owner,
                  _from: 21n,
                  _to: 22n,
                  _amountFrom: 100n,
                  _amountTo: 40n,
                  _amountFinal: 140n,
                  _locktime: 888n,
                  _ts: 777n,
                },
                ...mockEventData(2),
              },
              {
                contract: "VeNFT",
                event: "Withdraw",
                params: {
                  provider: owner,
                  tokenId: 22n,
                  value: 140n,
                  ts: 778n,
                },
                ...mockEventData(3),
              },
            ],
          },
        },
      });

      expect(
        (await indexer.VeNFTState.get(VeNFTId(chainId, 21n)))?.totalValueLocked,
      ).toBe(0n);
      expect(
        (await indexer.VeNFTState.get(VeNFTId(chainId, 22n)))?.totalValueLocked,
      ).toBe(0n);
    });
  });

  describe("Managed Flow Regression", () => {
    it("keeps normal and managed TVL consistent across depositManaged and withdrawManaged", async () => {
      const owner = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const indexer = createTestIndexer();
      indexer.VeNFTState.set({
        ...mockVeNFTState,
        id: VeNFTId(chainId, 31n),
        tokenId: 31n,
        owner,
        locktime: 0n,
        totalValueLocked: 80n,
      });
      indexer.VeNFTState.set({
        ...mockVeNFTState,
        id: VeNFTId(chainId, 32n),
        tokenId: 32n,
        owner,
        locktime: 0n,
        totalValueLocked: 200n,
      });

      const withdrawTs = 123456n;
      const expectedLocktime =
        ((withdrawTs + SECONDS_IN_FOUR_YEARS) / SECONDS_IN_A_WEEK) *
        SECONDS_IN_A_WEEK;
      const mockEventData = (logIndex: number) => ({
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0xmanaged",
        },
        srcAddress: owner,
        logIndex,
      });

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "DepositManaged",
                params: {
                  _owner: owner,
                  _tokenId: 31n,
                  _mTokenId: 32n,
                  _weight: 80n,
                  _ts: 1n,
                },
                ...mockEventData(1),
              },
              {
                contract: "VeNFT",
                event: "WithdrawManaged",
                params: {
                  _owner: owner,
                  _tokenId: 31n,
                  _mTokenId: 32n,
                  _weight: 80n,
                  _ts: withdrawTs,
                },
                ...mockEventData(2),
              },
            ],
          },
        },
      });

      expect(
        (await indexer.VeNFTState.get(VeNFTId(chainId, 31n)))?.totalValueLocked,
      ).toBe(80n);
      expect(
        (await indexer.VeNFTState.get(VeNFTId(chainId, 31n)))?.locktime,
      ).toBe(expectedLocktime);
      expect(
        (await indexer.VeNFTState.get(VeNFTId(chainId, 32n)))?.totalValueLocked,
      ).toBe(200n);
    });
  });
});
