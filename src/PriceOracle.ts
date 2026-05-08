import type { Token, handlerContext } from "generated";
import { estimateBlockAtTimestamp } from "./ChainBlockTime";
import {
  AFFECTED_CHAINS,
  CHAIN_CONSTANTS,
  MS_IN_AN_HOUR,
  PriceOracleType,
  TokenId,
} from "./Constants";
import {
  getTokenDetails,
  getTokenPrice,
  roundBlockToInterval,
} from "./Effects/Index";
import { EffectType, rpcGateway } from "./Effects/RpcGateway";
import { getRebindTarget, isBlacklistedToken } from "./PriceOverrides";
import { setTokenPriceSnapshot } from "./Snapshots/TokenPriceSnapshot";
export interface TokenPriceData {
  pricePerUSDNew: bigint;
  decimals: bigint;
}

export async function createTokenEntity(
  tokenAddress: string,
  chainId: number,
  blockNumber: number,
  context: handlerContext,
  blockTimestamp: number,
) {
  const blockDatetime = new Date(blockTimestamp * 1000);
  const tokenDetails = await context.effect(getTokenDetails, {
    contractAddress: tokenAddress,
    chainId,
  });

  const tokenEntity: Token = {
    id: TokenId(chainId, tokenAddress),
    address: tokenAddress,
    symbol: tokenDetails.symbol,
    name: tokenDetails.name, // Now using the actual name from token details
    chainId: chainId,
    decimals: BigInt(tokenDetails.decimals),
    pricePerUSDNew: BigInt(0),
    lastUpdatedTimestamp: blockDatetime,
    isWhitelisted: false,
  };

  context.Token.set(tokenEntity);
  return tokenEntity;
}

/**
 * Refreshes a token's price data if the update interval has passed.
 *
 * This function checks if enough time has passed since the last update (1 hour),
 * and if so, fetches new price data for the token. The token entity is updated
 * in the database with the new price and timestamp.
 *
 * @param {Token} token - The token entity to refresh
 * @param {number} blockNumber - The block number to fetch price data from
 * @param {number} blockTimestamp - The timestamp of the block in seconds
 * @param {number} chainId - The chain ID where the token exists
 * @param {any} context - The database context for updating entities
 * @returns {Promise<Token>} The updated token entity
 */
export async function refreshTokenPrice(
  token: Token,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<Token> {
  const blockTimestampMs = blockTimestamp * 1000;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  // Refresh logic:
  // - Missing timestamp → always refresh
  // - $0 price for <30 days → retry (connector fix or Change A may self-heal)
  // - $0 price for >30 days → stop retrying (accepted as unpriceable, bounds RPC waste)
  // - Non-zero price → refresh on hourly interval
  const shouldRefresh =
    !token.lastUpdatedTimestamp ||
    (token.pricePerUSDNew === 0n
      ? blockTimestampMs - token.lastUpdatedTimestamp.getTime() < THIRTY_DAYS_MS
      : blockTimestampMs - token.lastUpdatedTimestamp.getTime() >=
        MS_IN_AN_HOUR);

  if (!shouldRefresh) {
    return token;
  }

  // Issue #672: heal empty symbol/name from a transient RPC failure at token
  // creation. ERC20 metadata is otherwise treated as immutable, so a single
  // failure during createTokenEntity persists `?` (empty symbol) forever.
  const healedMetadata = await maybeHealMetadata(token, chainId, context);

  // Issue #669: blacklist + canonical rebind override the oracle for known-bad
  // (chain, token) pairs. See src/PriceOverrides.ts for rationale per token.
  if (isBlacklistedToken(chainId, token.address)) {
    const updated: Token = {
      ...token,
      ...healedMetadata,
      pricePerUSDNew: 0n,
      lastUpdatedTimestamp: new Date(blockTimestampMs),
    };
    context.Token.set(updated);
    return updated;
  }

  const rebindTarget = getRebindTarget(chainId, token.address);
  if (rebindTarget) {
    const sourceToken = await context.Token.get(
      TokenId(rebindTarget.chainId, rebindTarget.address),
    );
    let sourcePrice = sourceToken?.pricePerUSDNew ?? 0n;

    // Cold-sync gap: the source chain's indexer hasn't priced the source token
    // yet (e.g. Swell handler at T runs while OP indexer is still behind T).
    // Reach across to the source chain's oracle directly. The effect cache
    // key is (tokenAddress, chainId, blockNumber), and we round to the same
    // hour bucket the source chain's own indexer will use — so when the
    // source catches up its native refresh hits this cache slot for free.
    // Worked example walked through in test/PriceOracle.test.ts.
    if (sourcePrice === 0n) {
      const estimatedSourceBlock = estimateBlockAtTimestamp(
        rebindTarget.chainId,
        blockTimestamp,
      );
      if (estimatedSourceBlock !== undefined) {
        const sourceBlockRounded = roundBlockToInterval(
          estimatedSourceBlock,
          rebindTarget.chainId,
        );
        const prefetched = await context.effect(getTokenPrice, {
          tokenAddress: rebindTarget.address,
          chainId: rebindTarget.chainId,
          blockNumber: sourceBlockRounded,
        });
        sourcePrice = prefetched.pricePerUSDNew;
      }
    }

    const updated: Token = {
      ...token,
      ...healedMetadata,
      pricePerUSDNew: sourcePrice,
      lastUpdatedTimestamp: new Date(blockTimestampMs),
    };
    context.Token.set(updated);
    if (sourcePrice > 0n) {
      setTokenPriceSnapshot(
        token.address,
        chainId,
        blockNumber,
        new Date(blockTimestampMs),
        sourcePrice,
        token.isWhitelisted,
        context,
      );
    }
    return updated;
  }

  try {
    // Round block number to nearest hour interval for better cache hits
    // Cache key is based on input parameters, so rounding must happen before effect call
    const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

    // ERC20 metadata is mostly immutable, but symbol/name may have been
    // persisted as empty due to a transient RPC failure at createTokenEntity
    // time (issue #672). Heal happens above this try block; price fetch below.
    const priceData = await context.effect(getTokenPrice, {
      tokenAddress: token.address,
      chainId,
      blockNumber: roundedBlockNumber,
    });
    // TEMPORARY: Bypass effect cache for affected chains with $0 cached results.
    // These chains had broken oracle connectors that cached $0 prices permanently.
    // The rpcGateway effect (cache: false) re-fetches from now-fixed connectors.
    // Remove after one full reindex with fixed connectors.
    let currentPrice = priceData.pricePerUSDNew;
    if (currentPrice === 0n && AFFECTED_CHAINS.has(chainId)) {
      const bypassResult = (await context.effect(rpcGateway, {
        type: EffectType.GET_TOKEN_PRICE,
        tokenAddress: token.address,
        chainId,
        blockNumber: roundedBlockNumber,
      })) as { pricePerUSDNew: bigint; priceOracleType: string };
      currentPrice = bypassResult.pricePerUSDNew;
    }

    // If price fetch returned 0, it could mean:
    // 1. No price path exists in the oracle (token not configured)
    // 2. Historical state unavailable (RPC limitation)
    //
    // If we have a previous non-zero price, use it as fallback.
    // This works in harmony with Envio's effect caching - if the effect cache has a previous
    // successful result, it will be used. But if it returns 0, we fall back to the token's stored price.
    const shouldUseLastKnownPrice =
      currentPrice === 0n &&
      token.pricePerUSDNew > 0n &&
      token.lastUpdatedTimestamp &&
      // Only use last known price if it's relatively recent (within 7 days)
      // This prevents using very stale prices but allows for temporary oracle issues
      blockTimestampMs - token.lastUpdatedTimestamp.getTime() <
        7 * 24 * 60 * 60 * 1000;

    // We already know that Oracle V1 is a bit unreliable (we tested for WETH on Optimism and it kept failing)
    // Oracle V2 is also a bit unreliable and either way it is just used for a few blocks
    // So the main errors that we should be concerned about (and that impact most recent data) is those involving Oracle V3
    // This also reduces the initial spam when deploying the indexer
    if (
      shouldUseLastKnownPrice &&
      CHAIN_CONSTANTS[chainId].oracle.getType(blockNumber) ===
        PriceOracleType.V3
    ) {
      // Return token with existing price, but update timestamp to current block
      // This ensures we don't keep trying to refresh too frequently
      const updatedToken: Token = {
        ...token,
        ...healedMetadata,
        lastUpdatedTimestamp: new Date(blockTimestampMs),
      };
      context.Token.set(updatedToken);
      return updatedToken;
    }

    // Issue #673: only preserve the timestamp once the oracle has actually
    // been queryable. For tokens whose entity is created before
    // `oracle.startBlock`, every pre-deploy refresh returns $0 and would
    // otherwise pin the timestamp at creation — letting the 30-day backoff
    // trip before the oracle ever runs and stranding reward tokens at $0.
    const oracleDeployed =
      blockNumber >= CHAIN_CONSTANTS[chainId].oracle.startBlock;
    const updatedToken: Token = {
      ...token,
      ...healedMetadata,
      pricePerUSDNew: currentPrice,
      lastUpdatedTimestamp:
        oracleDeployed && currentPrice === 0n && token.pricePerUSDNew === 0n
          ? token.lastUpdatedTimestamp
          : new Date(blockTimestampMs),
    };
    context.Token.set(updatedToken);

    setTokenPriceSnapshot(
      token.address,
      chainId,
      blockNumber,
      new Date(blockTimestampMs),
      currentPrice,
      token.isWhitelisted,
      context,
    );
    return updatedToken;
  } catch (error) {
    context.log.error(
      `Error refreshing token price for ${token.address} on chain ${chainId}: ${error}`,
    );
    // Return original token if refresh fails - this preserves the last known price
    return token;
  }
}

/**
 * Re-fetches ERC20 metadata when the stored Token entity has an empty symbol or
 * name (issue #672). createTokenEntity calls getTokenDetails exactly once per
 * pool's PoolCreated event, so a transient RPC failure persists `?` (empty
 * symbol) on the Token forever. The Effect already bypasses cache on empty
 * results, so a fresh call retries the underlying RPC.
 *
 * Returns an overlay containing only the fields that were empty on `token` and
 * came back non-empty from the RPC. Callers spread it: `{ ...token, ...healed }`.
 * Failures are logged but never thrown — metadata is display-only and must not
 * abort the price refresh.
 *
 * @param token - Existing Token entity (read-only).
 * @param chainId - Chain to query.
 * @param context - Envio handler context for the effect call and logging.
 * @returns `{ symbol?, name? }` overlay; empty object if no heal applied.
 */
async function maybeHealMetadata(
  token: Token,
  chainId: number,
  context: handlerContext,
): Promise<{ symbol?: string; name?: string }> {
  if (token.symbol && token.name) {
    return {};
  }

  try {
    const details = await context.effect(getTokenDetails, {
      contractAddress: token.address,
      chainId,
    });
    const overlay: { symbol?: string; name?: string } = {};
    if (!token.symbol && details.symbol) overlay.symbol = details.symbol;
    if (!token.name && details.name) overlay.name = details.name;
    return overlay;
  } catch (error) {
    context.log.error(
      `Error refreshing token metadata for ${token.address} on chain ${chainId}: ${error}`,
    );
    return {};
  }
}
