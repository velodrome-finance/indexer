import type { handlerContext } from "generated";
import type { PoolData } from "../../Aggregators/Pool";
import {
  type LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
} from "../NFPM/NFPMCommonLogic";

/**
 * Attributes a direct (non-NFPM) CLPool Mint/Burn liquidity flow to the owner's
 * UserStatsPerPool, gated on the owner NOT being the pool's NFPM contract.
 *
 * CLPool.mint()/burn() are permissionless: vaults and strategies call them
 * directly, emitting no NFPM events, so their flows would otherwise never reach
 * any UserStatsPerPool. NFPM-routed positions also surface here with
 * `owner === pool.nfpmAddress`, but those are already credited to the real
 * holder via NFPM.Transfer/IncreaseLiquidity. Attributing them again here would
 * both create a bogus row keyed on the NFPM contract address and double-count
 * the flow (issue #790), so the NFPM-owned case is skipped.
 *
 * Centralising the gate here keeps the Mint and Burn handlers from drifting on
 * the discriminator that AC#2 depends on.
 *
 * When `nfpmAddress` is null — the two CL factories not yet mapped to an NFPM in
 * Constants.ts — a direct mint is indistinguishable from an NFPM-routed one, so
 * the gate conservatively skips rather than risk mis-crediting an NFPM-routed
 * flow. This self-heals once the factory→NFPM mapping is added.
 *
 * @param owner - The CLPool Mint/Burn `owner` param (EIP-55 checksummed).
 * @param poolAddress - The pool's address (`event.srcAddress`).
 * @param poolData - Pool data carrying the aggregator (for `nfpmAddress`) and
 *   the token instances used to value the flow.
 * @param context - Handler context for entity access.
 * @param amount0 - Raw token0 amount from the event.
 * @param amount1 - Raw token1 amount from the event.
 * @param blockTimestamp - Block timestamp in seconds.
 * @param changeType - `ADD` for Mint, `REMOVE` for Burn.
 * @returns Promise that resolves once the owner's UserStatsPerPool flow has been
 *   staged, or immediately when the flow is NFPM-routed (skipped).
 */
export async function attributeDirectCLLiquidityChange(
  owner: string,
  poolAddress: string,
  poolData: PoolData,
  context: handlerContext,
  amount0: bigint,
  amount1: bigint,
  blockTimestamp: number,
  changeType: LiquidityChangeType,
): Promise<void> {
  const nfpmAddress = poolData.liquidityPoolAggregator.nfpmAddress;
  if (nfpmAddress == null || owner === nfpmAddress) {
    return;
  }
  await attributeLiquidityChangeToUserStatsPerPool(
    owner,
    poolAddress,
    poolData,
    context,
    amount0,
    amount1,
    blockTimestamp,
    changeType,
  );
}
