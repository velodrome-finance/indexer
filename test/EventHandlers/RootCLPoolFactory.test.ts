import { createTestIndexer } from "envio";
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
import { simulateEvent } from "../testHelpers";
import { type MockPool, setupCommon } from "./Pool/common";

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

    const sharedBlock = {
      timestamp: 1000000,
      number: 123456,
      hash: "0xhash",
    };

    describe("when matching pool exists on leaf chain", () => {
      let indexer: ReturnType<typeof createTestIndexer>;
      let mockLiquidityPool: MockPool;

      beforeEach(async () => {
        const { createMockPool } = setupCommon();

        indexer = createTestIndexer();

        // Create a pool on the leaf chain with matching token addresses and tickSpacing
        mockLiquidityPool = createMockPool({
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

        // lastSnapshotTimestamp: undefined prevents Quirk 1 crash in shouldSnapshot.
        // Pool entity types lastSnapshotTimestamp as Date (non-null) — cast to bypass.
        indexer.Pool.set({
          ...mockLiquidityPool,
          lastSnapshotTimestamp: undefined,
        } as unknown as Parameters<typeof indexer.Pool.set>[0]);

        await simulateEvent(indexer, rootChainId, {
          contract: "RootCLPoolFactory",
          event: "RootPoolCreated",
          params: {
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress as `0x${string}`,
          },
          block: sharedBlock,
          logIndex: 1,
        });
      });

      it("should create RootPool_LeafPool entity", async () => {
        const rootPoolLeafPool = await indexer.RootPool_LeafPool.get(
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

      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should call flushPendingVotesAndDistributionsForRootPool with context, rootPoolAddress, and [RootPoolCreated]", () => {
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
      let indexer: ReturnType<typeof createTestIndexer>;
      const tokenId = 1n;
      const voteWeight = 100n;
      const ownerAddress = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const blockTimestamp = 1000000;
      const timestampMs = blockTimestamp * 1000;

      beforeEach(async () => {
        const {
          createMockPool,
          createMockVeNFTState,
          mockToken0Data,
          mockToken1Data,
        } = setupCommon();

        indexer = createTestIndexer();

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
        const mockLiquidityPool = createMockPool({
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

        // lastSnapshotTimestamp: undefined prevents Quirk 1 crash in shouldSnapshot.
        // Pool entity types lastSnapshotTimestamp as Date (non-null) — cast to bypass.
        indexer.Pool.set({
          ...mockLiquidityPool,
          lastSnapshotTimestamp: undefined,
        } as unknown as Parameters<typeof indexer.Pool.set>[0]);
        indexer.Token.set(leafToken0);
        indexer.Token.set(leafToken1);
        indexer.VeNFTState.set(veNFTState);
        indexer.PendingVote.set(pendingVote);

        await simulateEvent(indexer, rootChainId, {
          contract: "RootCLPoolFactory",
          event: "RootPoolCreated",
          params: {
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress as `0x${string}`,
          },
          block: sharedBlock,
          logIndex: 1,
        });
      });

      it("should create RootPool_LeafPool and flush pending votes to leaf pool", async () => {
        const rootPoolLeafPool = await indexer.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
        );
        expect(rootPoolLeafPool).toBeDefined();

        const processedPendingVote = await indexer.PendingVote.get(
          PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
        );
        expect(processedPendingVote).toBeUndefined();

        const leafPool = await indexer.Pool.get(
          PoolId(leafChainId, leafPoolAddress),
        );
        expect(leafPool?.veNFTamountStaked).toBe(voteWeight);
      });

      it("should update UserStatsPerPool and VeNFTPoolVote for the vote owner on leaf pool", async () => {
        const userStatsId = UserStatsPerPoolId(
          leafChainId,
          ownerAddress,
          leafPoolAddress,
        );
        const userStats = await indexer.UserStatsPerPool.get(userStatsId);
        expect(userStats).toBeDefined();
        expect(userStats?.veNFTamountStaked).toBe(voteWeight);

        const veNFTPoolVoteId = VeNFTPoolVoteId(
          leafChainId,
          tokenId,
          leafPoolAddress,
        );
        const veNFTPoolVote = await indexer.VeNFTPoolVote.get(veNFTPoolVoteId);
        expect(veNFTPoolVote).toBeDefined();
        expect(veNFTPoolVote?.veNFTamountStaked).toBe(voteWeight);
      });
    });

    describe("when no matching pool exists", () => {
      it("should not create RootPool_LeafPool entity", async () => {
        const indexer = createTestIndexer();
        await simulateEvent(indexer, rootChainId, {
          contract: "RootCLPoolFactory",
          event: "RootPoolCreated",
          params: {
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress as `0x${string}`,
          },
          block: sharedBlock,
          logIndex: 1,
        });

        const rootPoolLeafPool = await indexer.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
        );
        expect(rootPoolLeafPool).toBeUndefined();
      });

      it("should create PendingRootPoolMapping when no matching leaf pool exists", async () => {
        const indexer = createTestIndexer();
        await simulateEvent(indexer, rootChainId, {
          contract: "RootCLPoolFactory",
          event: "RootPoolCreated",
          params: {
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress as `0x${string}`,
          },
          block: sharedBlock,
          logIndex: 1,
        });

        const pendingMapping = await indexer.PendingRootPoolMapping.get(
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
      let indexer: ReturnType<typeof createTestIndexer>;

      beforeEach(async () => {
        const { createMockPool } = setupCommon();

        indexer = createTestIndexer();

        // Create two pools with the same rootPoolMatchingHash
        const mockLiquidityPool1 = createMockPool({
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
        const mockLiquidityPool2 = createMockPool({
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

        // lastSnapshotTimestamp: undefined prevents Quirk 1 crash in shouldSnapshot.
        // Pool entity types lastSnapshotTimestamp as Date (non-null) — cast to bypass.
        indexer.Pool.set({
          ...mockLiquidityPool1,
          lastSnapshotTimestamp: undefined,
        } as unknown as Parameters<typeof indexer.Pool.set>[0]);
        indexer.Pool.set({
          ...mockLiquidityPool2,
          lastSnapshotTimestamp: undefined,
        } as unknown as Parameters<typeof indexer.Pool.set>[0]);

        await simulateEvent(indexer, rootChainId, {
          contract: "RootCLPoolFactory",
          event: "RootPoolCreated",
          params: {
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress as `0x${string}`,
          },
          block: sharedBlock,
          logIndex: 1,
        });
      });

      it("should not create RootPool_LeafPool entity", async () => {
        const rootPoolLeafPool1 = await indexer.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
        );
        const rootPoolLeafPool2 = await indexer.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            toChecksumAddress("0xFc00000000000000000000000000000000000001"),
          ),
        );
        expect(rootPoolLeafPool1).toBeUndefined();
        expect(rootPoolLeafPool2).toBeUndefined();
      });
    });
  });
});
