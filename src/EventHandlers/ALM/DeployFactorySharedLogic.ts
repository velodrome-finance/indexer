import type { NonFungiblePosition } from "envio";
import { getWhereRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";

/** The AMM position a StrategyCreated event reports for the new strategy. */
export interface StrategyAmmPosition {
  pool: string;
  token0: string;
  token1: string;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
}

/**
 * Finds the NonFungiblePosition minted for a new ALM strategy.
 *
 * Candidates are the positions minted in the StrategyCreated transaction, by
 * the indexed `mintTransactionHash`. Only positions on the event's chain and
 * pool whose range, liquidity and tokens equal the event's AMM position match.
 * If several still match, the earliest mint (lowest `mintLogIndex`, then lowest
 * `tokenId`) is used, so the choice does not depend on the order the query
 * returns rows in.
 *
 * @param chainId - Chain the StrategyCreated event fired on
 * @param transactionHash - Hash of the StrategyCreated transaction
 * @param ammPosition - Pool, tokens, ticks and liquidity of the strategy's position
 * @param logPrefix - Prefix for the duplicate-match warning (e.g. "[ALMDeployFactoryV2]")
 * @param context - Handler context for entity access and logging
 * @returns The matching position, or undefined when none matches
 */
export async function findStrategyPosition(
  chainId: number,
  transactionHash: string,
  ammPosition: StrategyAmmPosition,
  logPrefix: string,
  context: handlerContext,
): Promise<NonFungiblePosition | undefined> {
  const { pool, token0, token1, tickLower, tickUpper, liquidity } = ammPosition;
  const positions =
    (await getWhereRehydrated(
      context.NonFungiblePosition,
      "NonFungiblePosition",
      { mintTransactionHash: { _eq: transactionHash } },
    )) ?? [];

  const matching = positions
    .filter(
      (pos: NonFungiblePosition) =>
        pos.chainId === chainId &&
        pos.pool === pool &&
        pos.tickLower === tickLower &&
        pos.tickUpper === tickUpper &&
        pos.liquidity === liquidity &&
        pos.token0 === token0 &&
        pos.token1 === token1,
    )
    .sort((a, b) =>
      a.mintLogIndex !== b.mintLogIndex
        ? a.mintLogIndex - b.mintLogIndex
        : a.tokenId < b.tokenId
          ? -1
          : a.tokenId > b.tokenId
            ? 1
            : 0,
    );

  if (matching.length > 1) {
    context.log.warn(
      `${logPrefix} Multiple NonFungiblePositions found for transaction hash ${transactionHash} on chain ${chainId} for pool ${pool} with tick lower ${tickLower}, tick upper ${tickUpper}, liquidity ${liquidity}, token0 ${token0} and token1 ${token1}. Using the earliest mint (tokenId ${matching[0].tokenId}).`,
    );
  }

  return matching[0];
}
