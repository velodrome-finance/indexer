import { createTestIndexer } from "envio";
import {
  PoolId,
  TokenId,
  VeNFTId,
  rootPoolMatchingHash,
  toChecksumAddress,
} from "../../src/Constants";
import { RootPoolId } from "../../src/EventHandlers/Voter/RootPoolLogic";
import { setupCommon } from "./Pool/common";

// RootCLPoolFactory.RootPoolCreated on Optimism creates the RootPool from the
// event alone and reads or writes nothing else (ADR 0009, flow C). The leaf
// pool is joined to it in the analytics layer (matching hash + factory).
describe("RootCLPoolFactory Events", () => {
  describe("RootPoolCreated Event", () => {
    // The following values are taken from an actual real event
    const rootChainId = 10 as const;
    const leafChainId = 252;
    const rootPoolAddress = toChecksumAddress(
      "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
    );
    // RootPoolCreated is emitted by the factory, not by the pool it creates.
    // An event only routes to a contract when its source address is one
    // configured for that chain.
    const rootCLPoolFactoryAddress = toChecksumAddress(
      "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
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
    const blockTimestamp = 1000000;
    const blockNumber = 123456;

    const rootPoolCreated = {
      contract: "RootCLPoolFactory" as const,
      event: "RootPoolCreated" as const,
      srcAddress: rootCLPoolFactoryAddress,
      logIndex: 1,
      block: { timestamp: blockTimestamp, number: blockNumber, hash: "0xhash" },
      params: {
        token0,
        token1,
        tickSpacing,
        chainid: BigInt(leafChainId),
        pool: rootPoolAddress,
      },
    };

    it("creates the RootPool with its leaf chain, pair, tick spacing, root factory and matching hash", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: { [rootChainId]: { simulate: [rootPoolCreated] } },
      });

      const rootPool = await indexer.RootPool.get(
        RootPoolId(rootChainId, rootPoolAddress),
      );
      expect(rootPool).toEqual({
        id: `${rootChainId}-${rootPoolAddress}`,
        chainId: rootChainId,
        rootPoolAddress,
        leafChainId,
        isCL: true,
        token0,
        token1,
        tickSpacing,
        isStable: undefined,
        rootFactoryAddress: rootCLPoolFactoryAddress,
        rootPoolMatchingHash: rootPoolMatchingHash(
          leafChainId,
          token0,
          token1,
          tickSpacing,
        ),
        gaugeAddress: undefined,
        gaugeIsAlive: false,
        veNFTamountStaked: 0n,
        totalEmissions: 0n,
        totalEmissionsUSD: 0n,
        numberOfDistributions: 0n,
        createdBlockNumber: BigInt(blockNumber),
        createdTimestamp: new Date(blockTimestamp * 1000),
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      });
    });

    it("writes nothing but the RootPool, even when the leaf pool and a veNFT exist", async () => {
      const { createMockPool, createMockVeNFTState } = setupCommon();
      const indexer = createTestIndexer();
      // A leaf pool that matches the root pool (same hash, the leaf CLFactory
      // at the root factory's address): it used to get a RootPool_LeafPool row.
      const leafPool = createMockPool({
        id: PoolId(leafChainId, leafPoolAddress),
        poolAddress: leafPoolAddress,
        chainId: leafChainId,
        token0_id: TokenId(leafChainId, token0),
        token1_id: TokenId(leafChainId, token1),
        token0_address: token0,
        token1_address: token1,
        tickSpacing,
        isCL: true,
        factoryAddress: rootCLPoolFactoryAddress,
        rootPoolMatchingHash: rootPoolMatchingHash(
          leafChainId,
          token0,
          token1,
          tickSpacing,
        ),
        veNFTamountStaked: 0n,
      });
      indexer.Pool.set(leafPool);
      indexer.VeNFTState.set(
        createMockVeNFTState({
          id: VeNFTId(rootChainId, 1n),
          chainId: rootChainId,
          tokenId: 1n,
        }),
      );

      await indexer.process({
        chains: { [rootChainId]: { simulate: [rootPoolCreated] } },
      });

      expect(await indexer.RootPool.getAll()).toHaveLength(1);
      expect(await indexer.RootPool_LeafPool.getAll()).toEqual([]);
      expect(await indexer.RootPoolVote.getAll()).toEqual([]);
      expect(await indexer.UserStatsPerPool.getAll()).toEqual([]);
      expect(await indexer.VeNFTPoolVote.getAll()).toEqual([]);
      expect(
        await indexer.Pool.get(PoolId(leafChainId, leafPoolAddress)),
      ).toEqual(leafPool);
    });

    it("keeps an existing RootPool as it is", async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: { [rootChainId]: { simulate: [rootPoolCreated] } },
      });
      const first = await indexer.RootPool.get(
        RootPoolId(rootChainId, rootPoolAddress),
      );
      if (!first) throw new Error("RootPool not created");
      indexer.RootPool.set({ ...first, veNFTamountStaked: 5n });

      await indexer.process({
        chains: {
          [rootChainId]: {
            simulate: [
              {
                ...rootPoolCreated,
                logIndex: 2,
                block: { ...rootPoolCreated.block, number: blockNumber + 1 },
              },
            ],
          },
        },
      });

      const after = await indexer.RootPool.get(
        RootPoolId(rootChainId, rootPoolAddress),
      );
      expect(after?.veNFTamountStaked).toBe(5n);
      expect(after?.createdBlockNumber).toBe(BigInt(blockNumber));
    });
  });
});
