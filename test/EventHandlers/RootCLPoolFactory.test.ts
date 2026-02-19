import "../eventHandlersRegistration";
import type { LiquidityPoolAggregator } from "generated";
import { MockDb, RootCLPoolFactory } from "generated/src/TestHelpers.gen";
import {
  PoolId,
  RootPoolLeafPoolId,
  TokenId,
  toChecksumAddress,
} from "../../src/Constants";
import { setupCommon } from "./Pool/common";

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
          rootPoolMatchingHash: `${leafChainId}_${token0}_${token1}_${tickSpacing}`,
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
    });

    describe("when no matching pool exists", () => {
      it("should not create RootPool_LeafPool entity", async () => {
        const resultDB = await mockDb.processEvents([mockEvent]);

        expect(
          Array.from(resultDB.entities.RootPool_LeafPool.getAll()),
        ).toHaveLength(0);
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
          rootPoolMatchingHash: `${leafChainId}_${token0}_${token1}_${tickSpacing}`,
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
          rootPoolMatchingHash: `${leafChainId}_${token0}_${token1}_${tickSpacing}`,
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
