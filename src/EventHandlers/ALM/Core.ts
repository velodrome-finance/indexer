import { indexer } from "envio";
import type { ALM_LP_Wrapper } from "envio";
import { updateALMLPWrapper } from "../../Aggregators/ALMLPWrapper";
import { getWhereRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";

/**
 * Resolve the ALM_LP_Wrapper a Rebalance event belongs to.
 *
 * The event carries the pool, not the wrapper, so the wrapper is found by its
 * indexed `pool` field. That field holds a bare address, and the same pool
 * address exists on several superchain leaf chains (CREATE2-deterministic CL
 * pools), where the ALMCore contract also shares one address. Entities are
 * per-chain, so the query only returns wrappers on the event's chain.
 *
 * Within a chain a pool can have more than one wrapper (Optimism and Base have
 * pools with both a DeployFactoryV1 and a DeployFactoryV2 wrapper, and both
 * receive Rebalance events). Then the wrapper whose current position is
 * the one being rebalanced away from (`tokenId === ammPositionIdBefore`) is
 * chosen; if that does not single one out, the event is logged and skipped
 * rather than applied to whichever row the query returned first. A single
 * wrapper on the chain is updated as before, whatever `ammPositionIdBefore` is.
 *
 * @param chainId - Chain the Rebalance event fired on
 * @param poolAddress - Pool address from the event payload
 * @param ammPositionIdBefore - Position id the strategy held before the rebalance
 * @param context - Handler context for entity access and logging
 * @returns The wrapper to update, or undefined when none (or no unique one) matches
 */
export async function findALMLPWrapperForRebalance(
  chainId: number,
  poolAddress: string,
  ammPositionIdBefore: bigint,
  context: handlerContext,
): Promise<ALM_LP_Wrapper | undefined> {
  const wrappers =
    (await getWhereRehydrated(context.ALM_LP_Wrapper, "ALM_LP_Wrapper", {
      pool: { _eq: poolAddress },
    })) ?? [];

  if (wrappers.length === 0) {
    context.log.warn(
      `[ALMCore] ALM_LP_Wrapper entity not found for pool ${poolAddress} on chain ${chainId}. Skipping Rebalance update.`,
    );
    return undefined;
  }

  if (wrappers.length === 1) {
    return wrappers[0];
  }

  const byPosition = wrappers.filter((w) => w.tokenId === ammPositionIdBefore);
  if (byPosition.length === 1) {
    return byPosition[0];
  }

  context.log.warn(
    `[ALMCore] ${wrappers.length} ALM_LP_Wrappers for pool ${poolAddress} on chain ${chainId} and ${byPosition.length} hold position ${ammPositionIdBefore}; cannot tell which one rebalanced. Skipping Rebalance update.`,
  );
  return undefined;
}

indexer.onEvent(
  { contract: "ALMCore", event: "Rebalance" },
  async ({ event, context }) => {
    const { pool, ammPositionInfo, ammPositionIdBefore, ammPositionIdAfter } =
      event.params.rebalanceEventParams;
    const { property, tickLower, tickUpper, liquidity } = ammPositionInfo;

    const timestamp = new Date(event.block.timestamp * 1000);

    const lpWrapper = await findALMLPWrapperForRebalance(
      event.chainId,
      pool,
      ammPositionIdBefore,
      context,
    );
    if (!lpWrapper) {
      return;
    }

    const lpWrapperDiff = {
      tokenId: ammPositionIdAfter,
      tickLower: tickLower,
      tickUpper: tickUpper,
      property: property,
      liquidity: liquidity,
      lastUpdatedTimestamp: timestamp,
    };

    await updateALMLPWrapper(
      lpWrapperDiff,
      lpWrapper,
      timestamp,
      context,
      event.chainId,
    );
  },
);
