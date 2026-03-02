import "../eventHandlersRegistration";
import type { LiquidityPoolAggregator } from "generated";
import { MockDb, RootCLPoolFactory } from "generated/src/TestHelpers.gen";
import {
  PendingRootPoolMappingId,
  PendingVoteId,
  PoolId,
  RootPoolLeafPoolId,
  TokenId,
  UserStatsPerPoolId,
  VeNFTId,
  VeNFTPoolVoteId,
  rootPoolMatchingHash,
  toChecksumAddress,
} from "../../src/Constants";
import { flushPendingVotesAndDistributionsForRootPool } from "../../src/EventHandlers/Voter/CrossChainPendingResolution";
import { setupCommon } from "./Pool/common";

vi.mock(
  "../../src/EventHandlers/Voter/CrossChainPendingResolution",
  async (importOriginal) => {
    // biome-ignore format: single line required so esbuild/TS parse the generic correctly
    const actual = await (importOriginal as () => Promise<typeof import("../../src/EventHandlers/Voter/CrossChainPendingResolution")>)();
    return {
      ...actual,
      flushPendingVotesAndDistributionsForRootPool: vi.fn(
        actual.flushPendingVotesAndDistributionsForRootPool,
      ),
    };
  },
);

describe("RootCLPoolFactory Events", () => {
  describe("RootPoolCreated Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<
      typeof RootCLPoolFactory.RootPoolCreated.createMockEvent
    >;
    // The following values are taken from an actual real event
    const rootChainId = 10; // Optimism
    const leafChainId = 252; // Fraxtal
    const rootPoolAddress = toChecksumAddress(
      "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
    );
    const leafPoolAddress = toChecksumAddress(
      "0x3BBdBAD64b383885031c4d9C8Afe0C3327d79888",
    );
    const token0 = toChecksumAddress(
      "0xFc00000000000000000000000000000000000001",
    );
    const token1 = toChecksumAddress(
      "0xFC00000000000000000000000000000000000006",
    );
    const tickSpacing = BigInt(100);

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = RootCLPoolFactory.RootPoolCreated.createMockEvent({
        token0,
        token1,
        tickSpacing,
        chainid: BigInt(leafChainId),
        pool: rootPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          chainId: rootChainId,
          logIndex: 1,
        },
      });
    });

    describe("when matching pool exists on leaf chain", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;

      beforeEach(async () => {
        const { createMockLiquidityPoolAggregator } = setupCommon();

        // Create a pool on the leaf chain with matching token addresses and tickSpacing
        mockLiquidityPool = createMockLiquidityPoolAggregator({
          id: PoolId(leafChainId, leafPoolAddress),
          poolAddress: leafPoolAddress,
          chainId: leafChainId,
          token0_id: TokenId(leafChainId, token0),
          token1_id: TokenId(leafChainId, token1),
          token0_address: token0,
          token1_address: token1,
          tickSpacing: tickSpacing,
          isCL: true,
          rootPoolMatchingHash: rootPoolMatchingHash(
            leafChainId,
            token0,
            token1,
            tickSpacing,
          ),
        });

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await mockDb.processEvents([mockEvent]);
      });

      it("should create RootPool_LeafPool entity", () => {
        const rootPoolLeafPool = resultDB.entities.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
        );
        expect(rootPoolLeafPool).toBeDefined();
        expect(rootPoolLeafPool?.rootChainId).toBe(rootChainId);
        expect(rootPoolLeafPool?.rootPoolAddress).toBe(rootPoolAddress);
        expect(rootPoolLeafPool?.leafChainId).toBe(leafChainId);
        expect(rootPoolLeafPool?.leafPoolAddress).toBe(leafPoolAddress);
      });

      it("should call flushPendingVotesAndDistributionsForRootPool with context, rootPoolAddress, and [RootPoolCreated]", () => {
        expect(
          flushPendingVotesAndDistributionsForRootPool,
        ).toHaveBeenCalledWith(
          expect.anything(),
          rootPoolAddress,
          "[RootPoolCreated]",
        );
      });
    });

    describe("when PendingVote(s) exist for the root pool", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      const tokenId = 1n;
      const voteWeight = 100n;
      const ownerAddress = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const blockTimestamp = 1000000;
      const timestampMs = blockTimestamp * 1000;

      beforeEach(async () => {
        const {
          createMockLiquidityPoolAggregator,
          createMockVeNFTState,
          mockToken0Data,
          mockToken1Data,
        } = setupCommon();

        const leafToken0 = {
          ...mockToken0Data,
          id: TokenId(leafChainId, mockToken0Data.address),
          chainId: leafChainId,
        };
        const leafToken1 = {
          ...mockToken1Data,
          id: TokenId(leafChainId, mockToken1Data.address),
          chainId: leafChainId,
        };
        const mockLiquidityPool = createMockLiquidityPoolAggregator({
          id: PoolId(leafChainId, leafPoolAddress),
          poolAddress: leafPoolAddress,
          chainId: leafChainId,
          token0_id: leafToken0.id,
          token1_id: leafToken1.id,
          token0_address: leafToken0.address,
          token1_address: leafToken1.address,
          tickSpacing: tickSpacing,
          isCL: true,
          rootPoolMatchingHash: rootPoolMatchingHash(
            leafChainId,
            token0,
            token1,
            tickSpacing,
          ),
          veNFTamountStaked: 0n,
        });
        const veNFTState = createMockVeNFTState({
          id: VeNFTId(rootChainId, tokenId),
          chainId: rootChainId,
          tokenId,
          owner: ownerAddress,
        });
        const pendingVote = {
          id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
          chainId: rootChainId,
          rootPoolAddress,
          tokenId,
          weight: voteWeight,
          eventType: "Voted",
          timestamp: new Date(timestampMs),
          blockNumber: BigInt(123456),
          transactionHash: "0xhash",
        };

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);
        mockDb = mockDb.entities.Token.set(leafToken0);
        mockDb = mockDb.entities.Token.set(leafToken1);
        mockDb = mockDb.entities.VeNFTState.set(veNFTState);
        mockDb = mockDb.entities.PendingVote.set(pendingVote);

        resultDB = await mockDb.processEvents([mockEvent]);
      });

      it("should create RootPool_LeafPool and flush pending votes to leaf pool", () => {
        const rootPoolLeafPool = resultDB.entities.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
        );
        expect(rootPoolLeafPool).toBeDefined();

        const processedPendingVote = resultDB.entities.PendingVote.get(
          PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
        );
        expect(processedPendingVote).toBeUndefined();

        const leafPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(leafChainId, leafPoolAddress),
        );
        expect(leafPool?.veNFTamountStaked).toBe(voteWeight);
      });

      it("should update UserStatsPerPool and VeNFTPoolVote for the vote owner on leaf pool", () => {
        const userStatsId = UserStatsPerPoolId(
          leafChainId,
          ownerAddress,
          leafPoolAddress,
        );
        const userStats = resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(userStats).toBeDefined();
        expect(userStats?.veNFTamountStaked).toBe(voteWeight);

        const veNFTPoolVoteId = VeNFTPoolVoteId(
          leafChainId,
          tokenId,
          leafPoolAddress,
        );
        const veNFTPoolVote =
          resultDB.entities.VeNFTPoolVote.get(veNFTPoolVoteId);
        expect(veNFTPoolVote).toBeDefined();
        expect(veNFTPoolVote?.veNFTamountStaked).toBe(voteWeight);
      });
    });

    describe("when no matching pool exists", () => {
      it("should not create RootPool_LeafPool entity", async () => {
        const resultDB = await mockDb.processEvents([mockEvent]);

        expect(
          Array.from(resultDB.entities.RootPool_LeafPool.getAll()),
        ).toHaveLength(0);
      });

      it("should create PendingRootPoolMapping when no matching leaf pool exists", async () => {
        const resultDB = await mockDb.processEvents([mockEvent]);

        const pendingMapping = resultDB.entities.PendingRootPoolMapping.get(
          PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        );
        expect(pendingMapping).toBeDefined();
        expect(pendingMapping?.rootPoolAddress).toBe(rootPoolAddress);
        expect(pendingMapping?.rootChainId).toBe(rootChainId);
        expect(pendingMapping?.leafChainId).toBe(leafChainId);
        expect(pendingMapping?.token0).toBe(token0);
        expect(pendingMapping?.token1).toBe(token1);
        expect(pendingMapping?.tickSpacing).toBe(tickSpacing);
        expect(pendingMapping?.rootPoolMatchingHash).toBe(
          rootPoolMatchingHash(leafChainId, token0, token1, tickSpacing),
        );
      });
    });

    describe("when multiple matching pools exist", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool1: LiquidityPoolAggregator;
      let mockLiquidityPool2: LiquidityPoolAggregator;

      beforeEach(async () => {
        const { createMockLiquidityPoolAggregator } = setupCommon();

        // Create two pools with the same rootPoolMatchingHash
        mockLiquidityPool1 = createMockLiquidityPoolAggregator({
          id: PoolId(leafChainId, leafPoolAddress),
          poolAddress: leafPoolAddress,
          chainId: leafChainId,
          token0_id: TokenId(leafChainId, token0),
          token1_id: TokenId(leafChainId, token1),
          token0_address: token0,
          token1_address: token1,
          tickSpacing: tickSpacing,
          isCL: true,
          rootPoolMatchingHash: rootPoolMatchingHash(
            leafChainId,
            token0,
            token1,
            tickSpacing,
          ),
        });

        // Different pool address
        mockLiquidityPool2 = createMockLiquidityPoolAggregator({
          id: PoolId(
            leafChainId,
            toChecksumAddress("0xFc00000000000000000000000000000000000001"),
          ),
          poolAddress: toChecksumAddress(
            "0xFc00000000000000000000000000000000000001",
          ),
          chainId: leafChainId,
          token0_id: TokenId(leafChainId, token0),
          token1_id: TokenId(leafChainId, token1),
          token0_address: token0,
          token1_address: token1,
          tickSpacing: tickSpacing,
          isCL: true,
          rootPoolMatchingHash: rootPoolMatchingHash(
            leafChainId,
            token0,
            token1,
            tickSpacing,
          ),
        });

        mockDb =
          mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool1);
        mockDb =
          mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool2);

        resultDB = await mockDb.processEvents([mockEvent]);
      });

      it("should not create RootPool_LeafPool entity", () => {
        expect(
          Array.from(resultDB.entities.RootPool_LeafPool.getAll()),
        ).toHaveLength(0);
      });
    });
  });
});
