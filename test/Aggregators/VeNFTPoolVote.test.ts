import type { VeNFTPoolVote, VeNFTState, handlerContext } from "generated";
import {
  loadOrCreateVeNFTPoolVote,
  loadPoolVotesByVeNFT,
  loadVeNFTPoolVote,
  updateVeNFTPoolVote,
} from "../../src/Aggregators/VeNFTPoolVote";
import { VeNFTPoolVoteId } from "../../src/Constants";

function getVeNFTPoolVoteStore(
  ctx: Partial<handlerContext>,
): NonNullable<handlerContext["VeNFTPoolVote"]> {
  const store = ctx.VeNFTPoolVote;
  if (!store) throw new Error("test setup: VeNFTPoolVote mock required");
  return store;
}

describe("VeNFTPoolVote", () => {
  const chainId = 10;
  const tokenId = 1n;
  const poolAddress = "0x3333333333333333333333333333333333333333";

  const mockVeNFTState: VeNFTState = {
    id: `${chainId}_${tokenId}`,
    chainId,
    tokenId,
    owner: "0x1111111111111111111111111111111111111111",
    locktime: 100n,
    lastUpdatedTimestamp: new Date(1000),
    totalValueLocked: 1000n,
    isAlive: true,
  } as VeNFTState;

  const mockVeNFTPoolVote: VeNFTPoolVote = {
    id: VeNFTPoolVoteId(chainId, tokenId, poolAddress),
    poolAddress,
    veNFTamountStaked: 100n,
    veNFTState_id: mockVeNFTState.id,
    lastUpdatedTimestamp: new Date(2000),
  } as VeNFTPoolVote;

  let mockContext: Partial<handlerContext>;

  beforeEach(() => {
    mockContext = {
      VeNFTPoolVote: {
        get: jest.fn(),
        getOrCreate: jest.fn(),
        getOrThrow: jest.fn(),
        set: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          poolAddress: { eq: jest.fn(), gt: jest.fn(), lt: jest.fn() },
          veNFTState_id: {
            eq: jest.fn().mockResolvedValue([]),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      log: {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
    } as unknown as handlerContext;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("VeNFTPoolVoteId", () => {
    it("returns id in format chainId_tokenId_poolAddress", () => {
      expect(VeNFTPoolVoteId(10, 1n, poolAddress)).toBe(`10_1_${poolAddress}`);
      expect(VeNFTPoolVoteId(8453, 42n, "0xabc")).toBe("8453_42_0xabc");
    });
  });

  describe("loadVeNFTPoolVote", () => {
    it("returns VeNFTPoolVote when entity exists", async () => {
      const store = getVeNFTPoolVoteStore(mockContext);
      jest.mocked(store.get).mockResolvedValue(mockVeNFTPoolVote);

      const result = await loadVeNFTPoolVote(
        chainId,
        tokenId,
        poolAddress,
        mockContext as handlerContext,
      );

      expect(result).toEqual(mockVeNFTPoolVote);
      expect(store.get).toHaveBeenCalledWith(
        VeNFTPoolVoteId(chainId, tokenId, poolAddress),
      );
    });

    it("returns undefined when entity does not exist", async () => {
      jest
        .mocked(getVeNFTPoolVoteStore(mockContext).get)
        .mockResolvedValue(undefined);

      const result = await loadVeNFTPoolVote(
        chainId,
        tokenId,
        poolAddress,
        mockContext as handlerContext,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("loadPoolVotesByVeNFT", () => {
    it("returns empty array when no votes exist", async () => {
      const store = getVeNFTPoolVoteStore(mockContext);
      jest.mocked(store.getWhere.veNFTState_id.eq).mockResolvedValue([]);

      const result = await loadPoolVotesByVeNFT(
        mockVeNFTState,
        mockContext as handlerContext,
      );

      expect(result).toEqual([]);
      expect(store.getWhere.veNFTState_id.eq).toHaveBeenCalledWith(
        mockVeNFTState.id,
      );
    });

    it("returns array of VeNFTPoolVote when votes exist", async () => {
      const votes = [mockVeNFTPoolVote];
      jest
        .mocked(getVeNFTPoolVoteStore(mockContext).getWhere.veNFTState_id.eq)
        .mockResolvedValue(votes);

      const result = await loadPoolVotesByVeNFT(
        mockVeNFTState,
        mockContext as handlerContext,
      );

      expect(result).toEqual(votes);
    });

    it("returns empty array when getWhere.veNFTState_id.eq returns undefined", async () => {
      jest
        .mocked(getVeNFTPoolVoteStore(mockContext).getWhere.veNFTState_id.eq)
        .mockResolvedValue(undefined as unknown as VeNFTPoolVote[]);

      const result = await loadPoolVotesByVeNFT(
        mockVeNFTState,
        mockContext as handlerContext,
      );

      expect(result).toEqual([]);
    });
  });

  describe("loadOrCreateVeNFTPoolVote", () => {
    it("returns existing entity when it exists", async () => {
      const store = getVeNFTPoolVoteStore(mockContext);
      jest.mocked(store.getOrCreate).mockResolvedValue(mockVeNFTPoolVote);

      const timestamp = new Date(3000);
      const result = await loadOrCreateVeNFTPoolVote(
        chainId,
        tokenId,
        poolAddress,
        mockVeNFTState,
        mockContext as handlerContext,
        timestamp,
      );

      expect(result).toEqual(mockVeNFTPoolVote);
      expect(store.getOrCreate).toHaveBeenCalledWith({
        id: VeNFTPoolVoteId(chainId, tokenId, poolAddress),
        poolAddress,
        veNFTamountStaked: 0n,
        veNFTState_id: mockVeNFTState.id,
        lastUpdatedTimestamp: timestamp,
      });
    });
  });

  describe("updateVeNFTPoolVote", () => {
    it("adds incremental weight and updates timestamp", async () => {
      const diff = {
        incrementalVeNFTamountStaked: 50n,
        lastUpdatedTimestamp: new Date(4000),
        veNFTStateId: mockVeNFTState.id,
      };

      const result = await updateVeNFTPoolVote(
        diff,
        mockVeNFTPoolVote,
        mockContext as handlerContext,
      );

      expect(result.veNFTamountStaked).toBe(150n); // 100n + 50n
      expect(result.lastUpdatedTimestamp).toEqual(new Date(4000));
      expect(getVeNFTPoolVoteStore(mockContext).set).toHaveBeenCalledWith(
        result,
      );
    });

    it("subtracts weight when delta is negative", async () => {
      const diff = {
        incrementalVeNFTamountStaked: -30n,
        lastUpdatedTimestamp: new Date(5000),
        veNFTStateId: mockVeNFTState.id,
      };

      const result = await updateVeNFTPoolVote(
        diff,
        mockVeNFTPoolVote,
        mockContext as handlerContext,
      );

      expect(result.veNFTamountStaked).toBe(70n); // 100n - 30n
    });

    it("leaves veNFTamountStaked unchanged when no incremental diff", async () => {
      const diff = {
        lastUpdatedTimestamp: new Date(6000),
      };

      const result = await updateVeNFTPoolVote(
        diff,
        mockVeNFTPoolVote,
        mockContext as handlerContext,
      );

      expect(result.veNFTamountStaked).toBe(100n);
      expect(result.lastUpdatedTimestamp).toEqual(new Date(6000));
    });

    it("keeps current lastUpdatedTimestamp when diff has no lastUpdatedTimestamp", async () => {
      const diff = {
        incrementalVeNFTamountStaked: 10n,
      };

      const result = await updateVeNFTPoolVote(
        diff,
        mockVeNFTPoolVote,
        mockContext as handlerContext,
      );

      expect(result.veNFTamountStaked).toBe(110n);
      expect(result.lastUpdatedTimestamp).toEqual(
        mockVeNFTPoolVote.lastUpdatedTimestamp,
      );
    });
  });
});
