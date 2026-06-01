import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

const BASE_INITIAL_MODULE = toChecksumAddress(
  "0x0AD08370c76Ff426F534bb2AFFD9b5555338ee68",
);
const OPTIMISM_MODULE = toChecksumAddress(
  "0xC565F7ba9c56b157Da983c4Db30e13F5f06C59D9",
);

const DEFAULT_BLOCK = {
  timestamp: 1000000,
  number: 123456,
  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
} as const;

describe("CustomUnstakedFeeModule Events", () => {
  let common: ReturnType<typeof setupCommon>;

  beforeEach(() => {
    common = setupCommon();
  });

  describe("SetCustomFee event — chain-parameterized", () => {
    // applyUnstakedFee routes on event.chainId, not srcAddress. These rows
    // exercise both deployments we ship today (Base Initial + Optimism) through
    // the same handler path.
    const chainCases = [
      {
        name: "Base (Initial deployment)",
        chainId: 8453,
        srcAddress: BASE_INITIAL_MODULE,
        fee: 250n,
      },
      {
        name: "Optimism",
        chainId: 10,
        srcAddress: OPTIMISM_MODULE,
        fee: 1000n,
      },
    ] as const;

    it.each(chainCases)(
      "should set unstakedFee on $name",
      async ({ chainId, srcAddress, fee }) => {
        const pool = common.createMockPool({ chainId });
        const indexer = createTestIndexer();
        indexer.Pool.set(pool);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "CustomUnstakedFeeModule",
                  event: "SetCustomFee",
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
  });

  describe("SetCustomFee event on Base (Initial deployment)", () => {
    const chainId = 8453 as const;

    it("should store the raw ZERO_FEE_INDICATOR sentinel (420) without normalization", async () => {
      const pool = common.createMockPool({ chainId });
      const indexer = createTestIndexer();
      indexer.Pool.set(pool);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CustomUnstakedFeeModule",
                event: "SetCustomFee",
                srcAddress: BASE_INITIAL_MODULE,
                logIndex: 1,
                block: DEFAULT_BLOCK,
                params: {
                  pool: pool.poolAddress as `0x${string}`,
                  fee: 420n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(pool.id);
      expect(updatedPool?.unstakedFee).toBe(420n);
    });

    it("should no-op (not throw) when the pool aggregator does not exist", async () => {
      const pool = common.createMockPool({ chainId });
      const indexer = createTestIndexer();

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CustomUnstakedFeeModule",
                event: "SetCustomFee",
                srcAddress: BASE_INITIAL_MODULE,
                logIndex: 1,
                block: DEFAULT_BLOCK,
                params: {
                  pool: pool.poolAddress as `0x${string}`,
                  fee: 250n,
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
});
