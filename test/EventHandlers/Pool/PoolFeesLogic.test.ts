import type { EvmEvent, Token } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import type { handlerContext } from "../../../src/EntityTypes";
import { processPoolFees } from "../../../src/EventHandlers/Pool/PoolFeesLogic";
import { setupCommon } from "./common";

describe("PoolFeesLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const token0 = mockToken0Data as Token; // 18 decimals
  const token1 = mockToken1Data as Token; // 6 decimals

  const mockEvent = {
    chainId: 10,
    block: {
      number: 123456,
      timestamp: 1000000,
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    logIndex: 1,
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    transaction: {
      hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    },
    params: {
      amount0: 1000n,
      amount1: 2000n,
      sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
    },
  } as unknown as EvmEvent<"Pool", "Fees">;

  let mockContext: handlerContext;

  beforeEach(() => {
    mockContext = {
      log: {
        error: () => {},
        warn: () => {},
        info: () => {},
      },
    } as unknown as handlerContext;
  });

  describe("processPoolFees", () => {
    it("returns pool and user diffs with 1e18-normalized token-amount fees only", () => {
      const result = processPoolFees(mockEvent, token0, token1);

      // token0 has 18 decimals (normalization is identity); token1 has 6, so
      // 2000 raw units → 2000 × 1e12 on a 1e18 base (issue #812).
      const expected0 = mockEvent.params.amount0; // 1000n (18 decimals → identity)
      const expected1 = mockEvent.params.amount1 * 10n ** 12n; // 2000 → 2e15

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.liquidityPoolDiff?.incrementalTotalFeesGenerated0).toBe(
        expected0,
      );
      expect(result.liquidityPoolDiff?.incrementalTotalFeesGenerated1).toBe(
        expected1,
      );
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
        new Date(mockEvent.block.timestamp * 1000),
      );

      expect(result.userDiff).toBeDefined();
      expect(result.userDiff?.incrementalTotalFeesContributed0).toBe(expected0);
      expect(result.userDiff?.incrementalTotalFeesContributed1).toBe(expected1);
      expect(result.userDiff?.lastActivityTimestamp).toEqual(
        new Date(mockEvent.block.timestamp * 1000),
      );
    });

    // Issue #797 / completion of #733: USD aggregates are now derived in
    // processPoolSwap from trusted volume × pool fee rate. The Fees handler
    // must contribute the raw token amounts only — leaving the USD path
    // single-leg-valued here is what produced 1000/1000 V2 pools warning
    // [FEE_VOLUME_DIVERGENCE] on c9b8978.
    it("does not write any USD fee field (issue #797)", () => {
      const result = processPoolFees(mockEvent, token0, token1);

      expect(
        result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD,
      ).toBeUndefined();
      expect(
        result.userDiff?.incrementalTotalFeesContributedUSD,
      ).toBeUndefined();
    });

    it("handles a single-leg fees event (amount1=0)", () => {
      const event = {
        ...mockEvent,
        params: { ...mockEvent.params, amount0: 1000n, amount1: 0n },
      } as unknown as EvmEvent<"Pool", "Fees">;

      const result = processPoolFees(event, token0, token1);

      // token0 has 18 decimals, so the 1e18 normalization is the identity here.
      expect(result.liquidityPoolDiff?.incrementalTotalFeesGenerated0).toBe(
        1000n,
      );
      expect(result.liquidityPoolDiff?.incrementalTotalFeesGenerated1).toBe(0n);
      expect(
        result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD,
      ).toBeUndefined();
    });
  });
});
