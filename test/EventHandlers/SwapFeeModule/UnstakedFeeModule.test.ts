import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

const GAUGE_CAPS_MODULE = toChecksumAddress(
  "0xCCC21f4750E8B3E9C095BCB5d2fF59247A2CCD35",
);
const GAUGES_V3_MODULE = toChecksumAddress(
  "0xc2cc3256434AfbC36Bb5e815e1Bb2151310a1a0b",
);
const INITIAL_CUSTOM_MODULE = toChecksumAddress(
  "0x0AD08370c76Ff426F534bb2AFFD9b5555338ee68",
);
const CHAIN_ID_BASE = 8453 as const;

const DEFAULT_BLOCK = {
  timestamp: 1000000,
  number: 123456,
  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
} as const;

describe("UnstakedFeeModule Events", () => {
  let common: ReturnType<typeof setupCommon>;

  beforeEach(() => {
    common = setupCommon();
  });

  describe("CustomFeeSet event", () => {
    const feeCases = [
      {
        label: "raw fee value",
        fee: 500n,
        srcAddress: GAUGE_CAPS_MODULE,
      },
      {
        label: "ZERO_FEE_INDICATOR sentinel (420) without normalization",
        fee: 420n,
        srcAddress: GAUGES_V3_MODULE,
      },
      {
        label: "fee=0 raw (distinct from null / never-set)",
        fee: 0n,
        srcAddress: GAUGE_CAPS_MODULE,
      },
    ] as const;

    it.each(feeCases)(
      "should store $label on the pool",
      async ({ fee, srcAddress }) => {
        const pool = common.createMockPool({
          chainId: CHAIN_ID_BASE,
        });
        const indexer = createTestIndexer();
        indexer.Pool.set(pool);

        await indexer.process({
          chains: {
            [CHAIN_ID_BASE]: {
              simulate: [
                {
                  contract: "UnstakedFeeModule",
                  event: "CustomFeeSet",
                  srcAddress: srcAddress,
                  logIndex: 1,
                  block: DEFAULT_BLOCK,
                  params: {
                    pool: pool.poolAddress as `0x${string}`,
                    fee,
                  },
                },
              ],
            },
          },
        });

        const updatedPool = await indexer.Pool.get(pool.id);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.unstakedFee).toBe(fee);
        // baseFee and currentFee must be orthogonal and untouched.
        expect(updatedPool?.baseFee).toBe(pool.baseFee);
        expect(updatedPool?.currentFee).toBe(pool.currentFee);
      },
    );

    it("should no-op (not throw) when the pool aggregator does not exist", async () => {
      const pool = common.createMockPool({
        chainId: CHAIN_ID_BASE,
      });
      const indexer = createTestIndexer();

      await indexer.process({
        chains: {
          [CHAIN_ID_BASE]: {
            simulate: [
              {
                contract: "UnstakedFeeModule",
                event: "CustomFeeSet",
                srcAddress: GAUGE_CAPS_MODULE,
                logIndex: 1,
                block: DEFAULT_BLOCK,
                params: {
                  pool: pool.poolAddress as `0x${string}`,
                  fee: 500n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(pool.id);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Last-writer-wins across module deployments", () => {
    it("applies the most-recent event regardless of which module (Custom vs plain) fired it", async () => {
      const pool = common.createMockPool({
        chainId: CHAIN_ID_BASE,
      });

      // First: Initial CustomUnstakedFeeModule fires SetCustomFee with 300.
      const indexer1 = createTestIndexer();
      indexer1.Pool.set(pool);

      await indexer1.process({
        chains: {
          [CHAIN_ID_BASE]: {
            simulate: [
              {
                contract: "CustomUnstakedFeeModule",
                event: "SetCustomFee",
                srcAddress: INITIAL_CUSTOM_MODULE,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
                },
                params: {
                  pool: pool.poolAddress as `0x${string}`,
                  fee: 300n,
                },
              },
            ],
          },
        },
      });

      const afterFirst = await indexer1.Pool.get(pool.id);

      // Then: Gauges V3 UnstakedFeeModule fires CustomFeeSet with 700 on a later block.
      // Fresh indexer seeded with state after the first event
      const indexer2 = createTestIndexer();
      indexer2.Pool.set({ ...pool, unstakedFee: afterFirst?.unstakedFee });

      await indexer2.process({
        chains: {
          [CHAIN_ID_BASE]: {
            simulate: [
              {
                contract: "UnstakedFeeModule",
                event: "CustomFeeSet",
                srcAddress: GAUGES_V3_MODULE,
                logIndex: 1,
                block: {
                  timestamp: 1000100,
                  number: 123500,
                  hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
                },
                params: {
                  pool: pool.poolAddress as `0x${string}`,
                  fee: 700n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer2.Pool.get(pool.id);
      expect(updatedPool?.unstakedFee).toBe(700n);
    });
  });
});
