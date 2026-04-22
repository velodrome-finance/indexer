import {
  CustomUnstakedFeeModule,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import "../../eventHandlersRegistration";
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

function createSetCustomFeeEvent(params: {
  poolAddress: string;
  fee: bigint;
  chainId: number;
  srcAddress: string;
}) {
  return CustomUnstakedFeeModule.SetCustomFee.createMockEvent({
    pool: params.poolAddress as `0x${string}`,
    fee: params.fee,
    mockEventData: {
      block: DEFAULT_BLOCK,
      chainId: params.chainId,
      logIndex: 1,
      srcAddress: params.srcAddress as `0x${string}`,
    },
  });
}

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
        const pool = common.createMockLiquidityPoolAggregator({ chainId });
        const populatedDb =
          MockDb.createMockDb().entities.LiquidityPoolAggregator.set(pool);

        const event = createSetCustomFeeEvent({
          poolAddress: pool.poolAddress,
          fee,
          chainId,
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
  });

  describe("SetCustomFee event on Base (Initial deployment)", () => {
    const chainId = 8453;

    it("should store the raw ZERO_FEE_INDICATOR sentinel (420) without normalization", async () => {
      const pool = common.createMockLiquidityPoolAggregator({ chainId });
      const populatedDb =
        MockDb.createMockDb().entities.LiquidityPoolAggregator.set(pool);

      const event = createSetCustomFeeEvent({
        poolAddress: pool.poolAddress,
        fee: 420n,
        chainId,
        srcAddress: BASE_INITIAL_MODULE,
      });

      const result = await populatedDb.processEvents([event]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(pool.id);
      expect(updatedPool?.unstakedFee).toBe(420n);
    });

    it("should no-op (not throw) when the pool aggregator does not exist", async () => {
      const pool = common.createMockLiquidityPoolAggregator({ chainId });
      const mockDb = MockDb.createMockDb();

      const event = createSetCustomFeeEvent({
        poolAddress: pool.poolAddress,
        fee: 250n,
        chainId,
        srcAddress: BASE_INITIAL_MODULE,
      });

      const result = await mockDb.processEvents([event]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(pool.id);
      expect(updatedPool).toBeUndefined();
    });
  });
});
