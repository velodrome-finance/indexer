import type { EvmEvent, Token } from "envio";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";

export interface PoolFeesResult {
  liquidityPoolDiff?: Partial<PoolDiff>;
  userDiff?: Partial<UserStatsPerPoolDiff>;
}

/**
 * Process a V2 Pool Fees event into token-amount diffs only.
 *
 * Token-amount fee fields (`totalFeesGenerated0/1`, `totalFeesContributed0/1`)
 * are stored 1e18-normalized so they share one scale with the CL path
 * (`CLPoolSwapLogic.calculateSwapFees`) — issue #812. The V2 `Pool.Fees` event
 * reports raw token units, so each leg is normalized here using its token's
 * decimals.
 *
 * USD fee aggregates are deliberately NOT written here. Per issue #797 they
 * are now derived in `processPoolSwap` from trusted volume × pool fee rate
 * (`volumeInUSD × currentFee / FEE_SCALE`), mirroring CL's path
 * (`CLPoolSwapLogic.calculateSwapFees`) and completing the #733 / regression
 * of #670 invariant `cumulative_fees ≤ cumulative_volume × fee_ratio`. The
 * Fees event only carries the input-side leg, so its old single-leg
 * `pickTrustedSwapVolumeUSD` valuation had no second leg to clamp against and
 * leaked any inflated/inconsistent input price straight into the USD
 * aggregate (1000/1000 `[FEE_VOLUME_DIVERGENCE]` warned pools on c9b8978 were V2).
 *
 * @param event - V2 Pool Fees event
 * @param token0Instance - Token0 entity (decimals used for 1e18 normalization)
 * @param token1Instance - Token1 entity (decimals used for 1e18 normalization)
 * @returns Pool and user diffs with 1e18-normalized token-unit fee amounts only
 */
export function processPoolFees(
  event: EvmEvent<"Pool", "Fees">,
  token0Instance: Token,
  token1Instance: Token,
): PoolFeesResult {
  // Normalize raw V2 fee amounts to a 1e18 base so V2 and CL agree (issue #812).
  const fees0 = normalizeTokenAmountTo1e18(
    event.params.amount0,
    Number(token0Instance.decimals),
  );
  const fees1 = normalizeTokenAmountTo1e18(
    event.params.amount1,
    Number(token1Instance.decimals),
  );

  // Token-amount fees only; USD fee is written in processPoolSwap (issue #797).
  const liquidityPoolDiff = {
    incrementalTotalFeesGenerated0: fees0,
    incrementalTotalFeesGenerated1: fees1,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Prepare user diff data
  const userDiff = {
    incrementalTotalFeesContributed0: fees0,
    incrementalTotalFeesContributed1: fees1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
