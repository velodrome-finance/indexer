import {
  CustomUnstakedFeeModule,
  MockDb,
  UnstakedFeeModule,
} from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import "../../eventHandlersRegistration";
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
const CHAIN_ID_BASE = 8453;

const DEFAULT_BLOCK = {
  timestamp: 1000000,
  number: 123456,
  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
} as const;

function createCustomFeeSetEvent(params: {
  poolAddress: string;
  fee: bigint;
  srcAddress: string;
  block?: { timestamp: number; number: number; hash: string };
}) {
  return UnstakedFeeModule.CustomFeeSet.createMockEvent({
    pool: params.poolAddress as `0x${string}`,
    fee: params.fee,
    mockEventData: {
      block: params.block ?? DEFAULT_BLOCK,
      chainId: CHAIN_ID_BASE,
      logIndex: 1,
      srcAddress: params.srcAddress as `0x${string}`,
    },
  });
}

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
        const pool = common.createMockLiquidityPoolAggregator({
          chainId: CHAIN_ID_BASE,
        });
        const populatedDb =
          MockDb.createMockDb().entities.LiquidityPoolAggregator.set(pool);

        const event = createCustomFeeSetEvent({
          poolAddress: pool.poolAddress,
          fee,
          srcAddress,
        });

        const result = await populatedDb.processEvents([event]);

        const updatedPool = result.entities.LiquidityPoolAggregator.get(
          pool.id,
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.unstakedFee).toBe(fee);
        // baseFee and currentFee must be orthogonal and untouched.
        expect(updatedPool?.baseFee).toBe(pool.baseFee);
        expect(updatedPool?.currentFee).toBe(pool.currentFee);
      },
    );

    it("should no-op (not throw) when the pool aggregator does not exist", async () => {
      const pool = common.createMockLiquidityPoolAggregator({
        chainId: CHAIN_ID_BASE,
      });
      const mockDb = MockDb.createMockDb();

      const event = createCustomFeeSetEvent({
        poolAddress: pool.poolAddress,
        fee: 500n,
        srcAddress: GAUGE_CAPS_MODULE,
      });

      const result = await mockDb.processEvents([event]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(pool.id);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Last-writer-wins across module deployments", () => {
    it("applies the most-recent event regardless of which module (Custom vs plain) fired it", async () => {
      const pool = common.createMockLiquidityPoolAggregator({
        chainId: CHAIN_ID_BASE,
      });
      let mockDb = MockDb.createMockDb();
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(pool);

      // First: Initial CustomUnstakedFeeModule fires SetCustomFee with 300.
      const initialEvent = CustomUnstakedFeeModule.SetCustomFee.createMockEvent(
        {
          pool: pool.poolAddress as `0x${string}`,
          fee: 300n,
          mockEventData: {
            block: {
              timestamp: 1000000,
              number: 123456,
              hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
            },
            chainId: CHAIN_ID_BASE,
            logIndex: 1,
            srcAddress: INITIAL_CUSTOM_MODULE,
          },
        },
      );
      mockDb = await mockDb.processEvents([initialEvent]);

      // Then: Gauges V3 UnstakedFeeModule fires CustomFeeSet with 700 on a later block.
      const laterEvent = createCustomFeeSetEvent({
        poolAddress: pool.poolAddress,
        fee: 700n,
        srcAddress: GAUGES_V3_MODULE,
        block: {
          timestamp: 1000100,
          number: 123500,
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        },
      });
      const result = await mockDb.processEvents([laterEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(pool.id);
      expect(updatedPool?.unstakedFee).toBe(700n);
    });
  });
});
