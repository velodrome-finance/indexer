import { createTestIndexer } from "envio";
import * as VeNFTStateModule from "../../src/Aggregators/VeNFTState";
import {
  SECONDS_IN_A_WEEK,
  SECONDS_IN_FOUR_YEARS,
  UserStatsPerPoolId,
  VeNFTId,
  toChecksumAddress,
} from "../../src/Constants";
import { rehydrateTimestamps } from "../../src/EntityTimestamps";
import * as VeNFTLogic from "../../src/EventHandlers/VeNFT/VeNFTLogic";
import { setupCommon } from "./Pool/common";

describe("VeNFT Events", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  const chainId = 10 as const;
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

  beforeEach(() => {
    indexer = createTestIndexer();
    indexer.VeNFTState.set({ ...mockVeNFTState });
  });

  describe("Transfer Event - Minting", () => {
    const mintEventData = {
      from: toChecksumAddress("0x0000000000000000000000000000000000000000"),
      to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      tokenId: 2n,
    };

    it("should create VeNFTState entity when minting (from zero address)", async () => {
      // Create a fresh indexer without the VeNFT for this tokenId
      const mintIndexer = createTestIndexer();
      await mintIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                srcAddress: toChecksumAddress(
                  "0x3333333333333333333333333333333333333333",
                ),
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  from: mintEventData.from,
                  to: mintEventData.to,
                  tokenId: mintEventData.tokenId,
                },
              },
            ],
          },
        },
      });

      const rawCreatedVeNFT = await mintIndexer.VeNFTState.get(
        VeNFTId(chainId, mintEventData.tokenId),
      );
      const createdVeNFT = rawCreatedVeNFT
        ? rehydrateTimestamps("VeNFTState", rawCreatedVeNFT)
        : undefined;

      expect(createdVeNFT).toBeDefined();
      expect(createdVeNFT?.id).toBe(VeNFTId(chainId, mintEventData.tokenId));
      expect(createdVeNFT?.chainId).toBe(chainId);
      expect(createdVeNFT?.tokenId).toBe(mintEventData.tokenId);
      expect(createdVeNFT?.owner).toBe(mintEventData.to);
      expect(createdVeNFT?.locktime).toBe(0n);
      expect(createdVeNFT?.totalValueLocked).toBe(0n);
      expect(createdVeNFT?.isAlive).toBe(true);
      expect(createdVeNFT?.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
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

      const reassignIndexer = createTestIndexer();
      reassignIndexer.VeNFTState.set(veNFT);
      reassignIndexer.UserStatsPerPool.set(oldUserStats);
      reassignIndexer.UserStatsPerPool.set(newUserStats);
      reassignIndexer.VeNFTPoolVote.set(veNFTPoolVote);

      await reassignIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                srcAddress: oldOwner,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0xhash",
                },
                params: {
                  from: oldOwner,
                  to: newOwner,
                  tokenId,
                },
              },
            ],
          },
        },
      });

      const updatedOldUserStats = await reassignIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolAddress),
      );
      const updatedNewUserStats = await reassignIndexer.UserStatsPerPool.get(
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

      const multiPoolIndexer = createTestIndexer();
      multiPoolIndexer.VeNFTState.set(veNFT);
      multiPoolIndexer.UserStatsPerPool.set(oldUserStatsA);
      multiPoolIndexer.UserStatsPerPool.set(oldUserStatsB);
      multiPoolIndexer.UserStatsPerPool.set(newUserStatsA);
      multiPoolIndexer.UserStatsPerPool.set(newUserStatsB);
      multiPoolIndexer.VeNFTPoolVote.set(tokenVotesA);
      multiPoolIndexer.VeNFTPoolVote.set(tokenVotesB);

      await multiPoolIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                srcAddress: oldOwner,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0xhash",
                },
                params: {
                  from: oldOwner,
                  to: newOwner,
                  tokenId,
                },
              },
            ],
          },
        },
      });

      const updatedOldA = await multiPoolIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolA),
      );
      const updatedOldB = await multiPoolIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolB),
      );
      const updatedNewA = await multiPoolIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, newOwner, poolA),
      );
      const updatedNewB = await multiPoolIndexer.UserStatsPerPool.get(
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

      const burnIndexer = createTestIndexer();
      burnIndexer.VeNFTState.set(veNFT);
      burnIndexer.UserStatsPerPool.set(oldUserStats);
      burnIndexer.VeNFTPoolVote.set(tokenVotes);

      await burnIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                srcAddress: oldOwner,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0xhash",
                },
                params: {
                  from: oldOwner,
                  to: zeroAddress,
                  tokenId,
                },
              },
            ],
          },
        },
      });

      const updatedOldUserStats = await burnIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolAddress),
      );
      expect(updatedOldUserStats?.veNFTamountStaked).toBe(0n);

      const newOwnerStats = await burnIndexer.UserStatsPerPool.get(
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

      const noVotesIndexer = createTestIndexer();
      noVotesIndexer.VeNFTState.set(veNFT);
      noVotesIndexer.UserStatsPerPool.set(oldUserStats);

      await noVotesIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                srcAddress: oldOwner,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0xhash",
                },
                params: {
                  from: oldOwner,
                  to: newOwner,
                  tokenId,
                },
              },
            ],
          },
        },
      });

      const updatedOldUserStats = await noVotesIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, oldOwner, poolAddress),
      );
      expect(updatedOldUserStats?.veNFTamountStaked).toBe(123n);
      const newOwnerStats = await noVotesIndexer.UserStatsPerPool.get(
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

    beforeEach(async () => {
      vi.spyOn(VeNFTStateModule, "updateVeNFTState").mockResolvedValue(
        undefined,
      );
      vi.spyOn(VeNFTLogic, "processVeNFTWithdraw");

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Withdraw",
                srcAddress: toChecksumAddress(
                  "0x3333333333333333333333333333333333333333",
                ),
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  provider: eventData.provider,
                  tokenId: eventData.tokenId,
                  value: eventData.value,
                  ts: eventData.ts,
                },
              },
            ],
          },
        },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should update VeNFTState on withdraw", async () => {
      // mockVeNFTState seeded in outer beforeEach: tokenId=1n, totalValueLocked=1n, locktime=1n, isAlive=true
      // processVeNFTWithdraw applies incrementalTotalValueLocked = -value = -1n
      // => totalValueLocked = 1n + (-1n) = 0n
      // isAlive is not set by withdraw => stays true
      // locktime is not set by withdraw => stays 1n
      // lastUpdatedTimestamp = new Date(1000000 * 1000)
      const raw = await indexer.VeNFTState.get(
        VeNFTId(chainId, eventData.tokenId),
      );
      const v = raw ? rehydrateTimestamps("VeNFTState", raw) : undefined;
      expect(v).toBeDefined();
      expect(v?.totalValueLocked).toBe(0n);
      expect(v?.isAlive).toBe(true);
      expect(v?.locktime).toBe(1n);
      expect(v?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
    });

    it("should not call processVeNFTWithdraw when VeNFTState is not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Withdraw",
                srcAddress: toChecksumAddress(
                  "0x3333333333333333333333333333333333333333",
                ),
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  provider: eventData.provider,
                  tokenId: eventData.tokenId,
                  value: eventData.value,
                  ts: eventData.ts,
                },
              },
            ],
          },
        },
      });

      const veNFT = await emptyIndexer.VeNFTState.get(
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

    beforeEach(async () => {
      vi.spyOn(VeNFTStateModule, "updateVeNFTState").mockResolvedValue(
        undefined,
      );
      vi.spyOn(VeNFTLogic, "processVeNFTDeposit");

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Deposit",
                srcAddress: toChecksumAddress(
                  "0x3333333333333333333333333333333333333333",
                ),
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  provider: eventData.provider,
                  tokenId: eventData.tokenId,
                  value: eventData.value,
                  locktime: eventData.locktime,
                  depositType: eventData.depositType,
                  ts: eventData.ts,
                },
              },
            ],
          },
        },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should update VeNFTState on deposit", async () => {
      // mockVeNFTState seeded in outer beforeEach: tokenId=1n, totalValueLocked=1n, locktime=1n, isPermanent=false, isAlive=true
      // processVeNFTDeposit applies incrementalTotalValueLocked = value = 1n
      // => totalValueLocked = 1n + 1n = 2n
      // locktime = event.params.locktime = 1n (unchanged)
      // isPermanent: locktime=1n ≠ 0n so isPermanent=undefined => aggregator keeps existing false
      // isAlive = true (set explicitly by deposit)
      // lastUpdatedTimestamp = new Date(1000000 * 1000)
      const raw = await indexer.VeNFTState.get(
        VeNFTId(chainId, eventData.tokenId),
      );
      const v = raw ? rehydrateTimestamps("VeNFTState", raw) : undefined;
      expect(v).toBeDefined();
      expect(v?.totalValueLocked).toBe(2n);
      expect(v?.locktime).toBe(1n);
      expect(v?.isPermanent).toBe(false);
      expect(v?.isAlive).toBe(true);
      expect(v?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
    });

    it("should not call processVeNFTDeposit when VeNFTState is not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Deposit",
                srcAddress: toChecksumAddress(
                  "0x3333333333333333333333333333333333333333",
                ),
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  provider: eventData.provider,
                  tokenId: eventData.tokenId,
                  value: eventData.value,
                  locktime: eventData.locktime,
                  depositType: eventData.depositType,
                  ts: eventData.ts,
                },
              },
            ],
          },
        },
      });

      const veNFT = await emptyIndexer.VeNFTState.get(
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
      const splitIndexer = createTestIndexer();
      splitIndexer.VeNFTState.set({
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
        logIndex,
        srcAddress: owner,
      });

      await splitIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                ...mockEventData(1),
                params: {
                  from: owner,
                  to: toChecksumAddress(
                    "0x0000000000000000000000000000000000000000",
                  ),
                  tokenId: 11n,
                },
              },
              {
                contract: "VeNFT",
                event: "Transfer",
                ...mockEventData(2),
                params: {
                  from: toChecksumAddress(
                    "0x0000000000000000000000000000000000000000",
                  ),
                  to: owner,
                  tokenId: 12n,
                },
              },
              {
                contract: "VeNFT",
                event: "Transfer",
                ...mockEventData(3),
                params: {
                  from: toChecksumAddress(
                    "0x0000000000000000000000000000000000000000",
                  ),
                  to: owner,
                  tokenId: 13n,
                },
              },
              {
                contract: "VeNFT",
                event: "Split",
                ...mockEventData(4),
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
              },
              {
                contract: "VeNFT",
                event: "Withdraw",
                ...mockEventData(5),
                params: {
                  provider: owner,
                  tokenId: 12n,
                  value: 30n,
                  ts: 556n,
                },
              },
            ],
          },
        },
      });

      expect(
        (await splitIndexer.VeNFTState.get(VeNFTId(chainId, 11n)))
          ?.totalValueLocked,
      ).toBe(0n);
      expect(
        (await splitIndexer.VeNFTState.get(VeNFTId(chainId, 12n)))
          ?.totalValueLocked,
      ).toBe(0n);
      expect(
        (await splitIndexer.VeNFTState.get(VeNFTId(chainId, 13n)))
          ?.totalValueLocked,
      ).toBe(70n);
    });
  });

  describe("Merge Flow Regression", () => {
    it("reconciles destination TVL before withdraw so it does not go negative", async () => {
      const owner = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const mergeIndexer = createTestIndexer();
      mergeIndexer.VeNFTState.set({
        ...mockVeNFTState,
        id: VeNFTId(chainId, 21n),
        tokenId: 21n,
        owner,
        locktime: 999n,
        totalValueLocked: 100n,
      });
      mergeIndexer.VeNFTState.set({
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
        logIndex,
        srcAddress: owner,
      });

      await mergeIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "Transfer",
                ...mockEventData(1),
                params: {
                  from: owner,
                  to: toChecksumAddress(
                    "0x0000000000000000000000000000000000000000",
                  ),
                  tokenId: 21n,
                },
              },
              {
                contract: "VeNFT",
                event: "Merge",
                ...mockEventData(2),
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
              },
              {
                contract: "VeNFT",
                event: "Withdraw",
                ...mockEventData(3),
                params: {
                  provider: owner,
                  tokenId: 22n,
                  value: 140n,
                  ts: 778n,
                },
              },
            ],
          },
        },
      });

      expect(
        (await mergeIndexer.VeNFTState.get(VeNFTId(chainId, 21n)))
          ?.totalValueLocked,
      ).toBe(0n);
      expect(
        (await mergeIndexer.VeNFTState.get(VeNFTId(chainId, 22n)))
          ?.totalValueLocked,
      ).toBe(0n);
    });
  });

  describe("Managed Flow Regression", () => {
    it("keeps normal and managed TVL consistent across depositManaged and withdrawManaged", async () => {
      const owner = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const managedIndexer = createTestIndexer();
      managedIndexer.VeNFTState.set({
        ...mockVeNFTState,
        id: VeNFTId(chainId, 31n),
        tokenId: 31n,
        owner,
        locktime: 0n,
        totalValueLocked: 80n,
      });
      managedIndexer.VeNFTState.set({
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
        logIndex,
        srcAddress: owner,
      });

      await managedIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VeNFT",
                event: "DepositManaged",
                ...mockEventData(1),
                params: {
                  _owner: owner,
                  _tokenId: 31n,
                  _mTokenId: 32n,
                  _weight: 80n,
                  _ts: 1n,
                },
              },
              {
                contract: "VeNFT",
                event: "WithdrawManaged",
                ...mockEventData(2),
                params: {
                  _owner: owner,
                  _tokenId: 31n,
                  _mTokenId: 32n,
                  _weight: 80n,
                  _ts: withdrawTs,
                },
              },
            ],
          },
        },
      });

      expect(
        (await managedIndexer.VeNFTState.get(VeNFTId(chainId, 31n)))
          ?.totalValueLocked,
      ).toBe(80n);
      expect(
        (await managedIndexer.VeNFTState.get(VeNFTId(chainId, 31n)))?.locktime,
      ).toBe(expectedLocktime);
      expect(
        (await managedIndexer.VeNFTState.get(VeNFTId(chainId, 32n)))
          ?.totalValueLocked,
      ).toBe(200n);
    });
  });
});
