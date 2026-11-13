import type { Token } from "envio";
import { TokenId } from "./Constants";
import { getTokenDetails, hasContractBytecode } from "./Effects/Index";
import { getRehydrated } from "./EntityTimestamps";
import type { handlerContext } from "./EntityTypes";
import type { Pool } from "./EntityTypes";
import { getRebindTarget, isBlacklistedToken } from "./PriceOverrides";
import { getGateDecisionFromSignals } from "./PriceTrust";
import {
  type PricingCandidate,
  buildPricingCandidate,
  selectPricingCandidate,
} from "./Pricing/PoolRoute";
import {
  type PriceResolution,
  applyPriceResolution,
  isPriceRefreshDue,
} from "./Pricing/PriceResolution";
import {
  MAX_ACCEPTED_PRICE,
  PRICE_CARRY_WINDOW_MS,
  PRICING_TIER,
  type PricingTier,
  getMinPricingDepthUSD,
  getPinnedPrice,
  getPricingTier,
} from "./Pricing/PricingConfig";
import { setTokenPriceSnapshot } from "./Snapshots/TokenPriceSnapshot";

/**
 * Price fields for a Token row created at `createdAt`: tier-0 tokens (the
 * chain's destination token and stablecoins) are born at their $1 pin with a
 * matching success stamp, everything else at 0 with no success yet. Shared by
 * every Token construction site so a stablecoin first seen through
 * `WhitelistToken` is not valued at $0 for its first (throttled) hour.
 *
 * @param chainId - Chain the token lives on
 * @param address - Token address
 * @param createdAt - Creation block time (callers also stamp it as `lastUpdatedTimestamp`)
 * @returns `pricePerUSDNew` and `lastSuccessfulPriceTimestamp` for the new row
 */
export function initialTokenPriceFields(
  chainId: number,
  address: string,
  createdAt: Date,
): Pick<Token, "pricePerUSDNew" | "lastSuccessfulPriceTimestamp"> {
  const pinned = isBlacklistedToken(chainId, address)
    ? undefined
    : getPinnedPrice(chainId, address);
  return pinned
    ? { pricePerUSDNew: pinned, lastSuccessfulPriceTimestamp: createdAt }
    : { pricePerUSDNew: 0n, lastSuccessfulPriceTimestamp: undefined };
}

/**
 * Creates and persists a Token entity at first sight, gated on the address
 * actually being a contract on-chain.
 *
 * Issue #677: addresses with no deployed bytecode (EOAs, never-deployed
 * contracts) used to write Token rows with empty `symbol`/`name` from the
 * static fallback in {@link getTokenDetails}. The bytecode gate filters them
 * here so callers see `null` and can skip downstream work.
 *
 * Tier-0 tokens (the chain's destination token and stablecoins) are born at
 * their $1 pin, so the first hour after creation — during which the refresh is
 * throttled by the creation stamp — does not value them at $0. Every other
 * token starts at 0 and gets its first pool-derived price at its first
 * refresh in a later hour (its own new pool has no reserves yet anyway).
 *
 * @param tokenAddress - Address of the token contract.
 * @param chainId - Chain ID where the token lives.
 * @param blockNumber - Block at which the entity is being created.
 * @param context - Envio handler context for effects + Token.set.
 * @param blockTimestamp - Block timestamp in seconds; stored as `lastUpdatedTimestamp`.
 * @returns The created Token entity, or `null` when the address has no deployed bytecode.
 */
export async function createTokenEntity(
  tokenAddress: string,
  chainId: number,
  blockNumber: number,
  context: handlerContext,
  blockTimestamp: number,
): Promise<Token | null> {
  const blockDatetime = new Date(blockTimestamp * 1000);

  const { hasCode } = await context.effect(hasContractBytecode, {
    address: tokenAddress,
    chainId,
  });
  if (!hasCode) {
    context.log.warn(
      `[createTokenEntity] Skipping Token row for non-contract address ${tokenAddress} on chain ${chainId} (no deployed bytecode)`,
    );
    return null;
  }

  const tokenDetails = await context.effect(getTokenDetails, {
    contractAddress: tokenAddress,
    chainId,
  });

  const decision = getGateDecisionFromSignals(chainId, tokenAddress, false);
  const tokenEntity: Token = {
    id: TokenId(chainId, tokenAddress),
    address: tokenAddress,
    symbol: tokenDetails.symbol,
    name: tokenDetails.name, // Now using the actual name from token details
    chainId: chainId,
    decimals: BigInt(tokenDetails.decimals),
    ...initialTokenPriceFields(chainId, tokenAddress, blockDatetime),
    lastUpdatedTimestamp: blockDatetime,
    isWhitelisted: false,
    priceTrustOutcome: decision.outcome,
    priceTrustReason: decision.reason,
  };

  context.Token.set(tokenEntity);
  return tokenEntity;
}

/**
 * Refreshes a token's USD price from indexed pool state, at most once per
 * token per clock hour (docs/adr/0003-pool-derived-token-prices.md). No RPC is
 * involved: the price comes from pools already in the store.
 *
 * Resolution order on a due refresh:
 *
 * 1. Operator blacklist (src/PriceOverrides.ts) → 0 (`override`).
 * 2. Tier 0 (destination token / stablecoins) → exactly $1 (`pinned`).
 * 3. Pool route: every pool registered for the token in `TokenPricingPools`
 *    (counterparty in a strictly lower tier) offers a candidate price =
 *    pool ratio × counterparty USD price. Each counterparty is refreshed first
 *    when it is itself due, so the token is never priced off a stale
 *    counterparty; the tier rule bounds that recursion at three levels. The
 *    deepest candidate passing the depth floor, the 1000× imbalance bound and
 *    the $1M ceiling wins (`pool`).
 * 4. Cross-chain rebind (e.g. XVELO on leaf chains → Optimism VELO): when no
 *    local pool qualifies, copy the source token's stored price if it is
 *    positive and was successfully set within the carry window (`rebind`).
 * 5. Nothing qualified: carry the last price while its last success is under
 *    7 days old (`carried`), else 0 (`unpriced`).
 *
 * Two clocks (#694): `lastUpdatedTimestamp` advances on every due refresh
 * (it is the throttle); `lastSuccessfulPriceTimestamp` only on steps 2–4.
 * Every due refresh writes exactly one TokenPriceSnapshot, keyed by the clock
 * hour; a throttled call writes nothing.
 *
 * Token metadata is healed (#735) on every call, throttled or not.
 *
 * @param token - The token entity to refresh.
 * @param blockNumber - Block of the triggering event (kept for call-site
 *   compatibility; pricing reads current store state, not a block).
 * @param blockTimestamp - Block timestamp in seconds.
 * @param chainId - Chain the token lives on.
 * @param context - Envio handler context.
 * @returns The updated token entity (or the healed input when throttled).
 */
export async function refreshTokenPrice(
  token: Token,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<Token> {
  const healed = await healTokenMetadata(token, chainId, context);
  const blockTimestampMs = blockTimestamp * 1000;
  if (!isPriceRefreshDue(healed.lastUpdatedTimestamp, blockTimestampMs)) {
    return healed;
  }

  let resolution: PriceResolution;
  try {
    resolution = await resolveTokenPrice(
      healed,
      blockNumber,
      blockTimestamp,
      chainId,
      context,
    );
  } catch (error) {
    // A failed store read must not abort the handler or zero the price:
    // treat it as "nothing qualified" so the carry rule applies.
    context.log.error(
      `[refreshTokenPrice] Error resolving price for ${healed.address} on chain ${chainId}: ${error}`,
    );
    resolution = { kind: "none" };
  }

  const applied = applyPriceResolution(healed, resolution, blockTimestampMs);
  context.Token.set(applied.token);
  setTokenPriceSnapshot(
    {
      address: applied.token.address,
      chainId,
      timestamp: new Date(blockTimestampMs),
      pricePerUSDNew: applied.token.pricePerUSDNew,
      isWhitelisted: applied.token.isWhitelisted,
      priceSource: applied.priceSource,
      pricingPoolId: applied.pricingPoolId,
      pricingDepthUSD: applied.pricingDepthUSD,
    },
    context,
  );
  return applied.token;
}

/**
 * Decides how a due refresh prices `token` (steps 1–4 of
 * {@link refreshTokenPrice}); carry / expiry is applied afterwards by
 * `applyPriceResolution`.
 *
 * @param token - The token being refreshed (already healed)
 * @param blockNumber - Block of the triggering event (passed to counterparty refreshes)
 * @param blockTimestamp - Block timestamp in seconds
 * @param chainId - Chain the token lives on
 * @param context - Envio handler context
 * @returns The resolution
 */
async function resolveTokenPrice(
  token: Token,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<PriceResolution> {
  if (isBlacklistedToken(chainId, token.address)) {
    return { kind: "override" };
  }

  const tier = getPricingTier(chainId, token.address);
  if (tier === PRICING_TIER.PINNED) {
    return { kind: "pinned" };
  }

  const best = await findPoolRoute(
    token,
    tier,
    blockNumber,
    blockTimestamp,
    chainId,
    context,
  );
  if (best) {
    return {
      kind: "pool",
      priceUSD: best.priceUSD,
      poolId: best.poolId,
      depthUSD: best.depthUSD,
    };
  }

  const rebindPrice = await findRebindPrice(
    token,
    chainId,
    blockTimestamp * 1000,
    context,
  );
  if (rebindPrice !== undefined) {
    return { kind: "rebind", priceUSD: rebindPrice };
  }

  return { kind: "none" };
}

/**
 * Loads the token's registered pricing pools and their counterparties,
 * refreshes each counterparty that is due, and selects the deepest qualifying
 * candidate. Reads are issued together with `Promise.all` so Envio's preload
 * pass batches them.
 *
 * Counterparties are re-checked against the tier rule here as well as at
 * registration, so even a stale or hand-edited `TokenPricingPools` row cannot
 * make the recursion cyclic.
 *
 * @param token - The token being priced
 * @param tier - The token's pricing tier
 * @param blockNumber - Block of the triggering event
 * @param blockTimestamp - Block timestamp in seconds
 * @param chainId - Chain the token lives on
 * @param context - Envio handler context
 * @returns The winning candidate, or `undefined` when none qualifies
 */
async function findPoolRoute(
  token: Token,
  tier: PricingTier,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<PricingCandidate | undefined> {
  const registered = await context.TokenPricingPools.get(token.id);
  const poolIds = registered?.pools ?? [];
  if (poolIds.length === 0) return undefined;

  const pools = (
    await Promise.all(
      poolIds.map((id) => getRehydrated(context.Pool, "Pool", id)),
    )
  ).filter((pool): pool is Pool => pool !== undefined);

  const counterpartyIdOf = (pool: Pool): string =>
    pool.token0_id === token.id ? pool.token1_id : pool.token0_id;
  const counterpartyIds = [...new Set(pools.map(counterpartyIdOf))];
  const counterparties = await Promise.all(
    counterpartyIds.map((id) => getRehydrated(context.Token, "Token", id)),
  );

  const refreshed = await Promise.all(
    counterparties.map((counterparty) =>
      counterparty && getPricingTier(chainId, counterparty.address) < tier
        ? refreshTokenPrice(
            counterparty,
            blockNumber,
            blockTimestamp,
            chainId,
            context,
          )
        : undefined,
    ),
  );
  const counterpartyById = new Map<string, Token>();
  for (const counterparty of refreshed) {
    if (counterparty) counterpartyById.set(counterparty.id, counterparty);
  }

  const candidates: PricingCandidate[] = [];
  for (const pool of pools) {
    const counterparty = counterpartyById.get(counterpartyIdOf(pool));
    if (!counterparty) continue;
    const candidate = buildPricingCandidate(pool, token, counterparty);
    if (candidate) candidates.push(candidate);
  }
  return selectPricingCandidate(candidates, getMinPricingDepthUSD(chainId));
}

/**
 * Cross-chain rebind fallback (src/PriceOverrides.ts `REBINDS`): the source
 * token's stored price, when it is positive, within the absolute ceiling, and
 * was last successfully set within the carry window of this block. The source
 * is never refreshed from here (its chain has its own block clock) and the
 * on-chain oracle is never consulted.
 *
 * @param token - The token being priced
 * @param chainId - Chain the token lives on
 * @param blockTimestampMs - Current block timestamp in milliseconds
 * @param context - Envio handler context
 * @returns The source price, or `undefined` when there is no rebind or the
 *   source has no usable price
 */
async function findRebindPrice(
  token: Token,
  chainId: number,
  blockTimestampMs: number,
  context: handlerContext,
): Promise<bigint | undefined> {
  const target = getRebindTarget(chainId, token.address);
  if (!target) return undefined;
  const source = await getRehydrated(
    context.Token,
    "Token",
    TokenId(target.chainId, target.address),
  );
  const lastSuccess = source?.lastSuccessfulPriceTimestamp;
  if (
    !source ||
    source.pricePerUSDNew <= 0n ||
    source.pricePerUSDNew > MAX_ACCEPTED_PRICE ||
    !lastSuccess ||
    blockTimestampMs - lastSuccess.getTime() >= PRICE_CARRY_WINDOW_MS
  ) {
    return undefined;
  }
  return source.pricePerUSDNew;
}

/**
 * Re-fetches ERC20 metadata when the stored Token entity has an empty symbol or
 * name (issues #672, #735). `createTokenEntity` calls `getTokenDetails` exactly
 * once per pool's `PoolCreated` event, so a transient RPC failure persists `?`
 * (empty symbol) on the Token forever.
 *
 * Also re-derives a fallback-origin `decimals` (issue #820): when the stored
 * row carries the full TOKEN_DETAILS_FALLBACK fingerprint (empty symbol AND
 * empty name — the only shape under which `decimals` is the stubbed 18 rather
 * than a real read) and a genuine fresh read reports a different value, the
 * corrected decimals is overlaid alongside symbol/name. A row missing only one
 * of symbol/name had a real creation-time read (a failed read replaces all
 * three fields with the fallback) so its decimals is left untouched, as is a
 * legitimately 18-decimal token — which has a symbol and never reaches this
 * path.
 *
 * Exported so callers can heal outside the price-refresh path (issues #735,
 * #820): `refreshTokenPrice` runs this above the 1-hour throttle so the first
 * Swap / Mint / Burn / Voter event after a pool's creation clears empty
 * metadata even when the event lands inside the throttle window, and the
 * `WhitelistToken` handlers call it so whitelisted tokens that never hit
 * `refreshTokenPrice` (never a pool/reward token) still heal.
 *
 * Idempotent: once `symbol` and `name` are both populated the function
 * short-circuits without an effect call. When `getTokenDetails` legitimately
 * returns empty values (e.g. contract reverts on `symbol()`), the function
 * stages no `Token.set` write — Envio's effect cache absorbs the deterministic
 * `CONTRACT_REVERT` result, so subsequent events incur no extra RPC either.
 *
 * Failures are logged but never thrown — metadata is display-only and must not
 * abort the calling event handler.
 *
 * @param token - Existing Token entity (read-only).
 * @param chainId - Chain to query.
 * @param context - Envio handler context for the effect call, `Token.set`, and logging.
 * @returns The healed Token entity (with overlaid `symbol` / `name` and, for a
 *          fallback-origin row, `decimals`) when fresh values were available;
 *          the original `token` reference otherwise.
 */
export async function healTokenMetadata(
  token: Token,
  chainId: number,
  context: handlerContext,
): Promise<Token> {
  if (token.symbol && token.name) {
    return token;
  }

  try {
    const details = await context.effect(getTokenDetails, {
      contractAddress: token.address,
      chainId,
    });
    const overlay: { symbol?: string; name?: string; decimals?: bigint } = {};
    if (!token.symbol && details.symbol) overlay.symbol = details.symbol;
    if (!token.name && details.name) overlay.name = details.name;
    // Issue #820: re-derive a fallback-origin `decimals`. It is written once at
    // creation and was never healed, so a token created from the
    // TOKEN_DETAILS_FALLBACK constant (transient RPC failure or full contract
    // revert ⇒ empty symbol AND empty name AND the stubbed decimals=18) stayed
    // mis-scaled by 10^(18-real) forever for a non-18 token (USDC=6, WBTC=8).
    // The fingerprint is BOTH symbol and name empty — the exact fallback shape.
    // A failed `getTokenDetails` replaces all three fields with the fallback
    // constant, so a row missing only one of symbol/name had a real
    // creation-time read and its decimals is trusted and left untouched; a
    // legitimately 18-decimal token has a symbol and never reaches this heal
    // path. A non-empty `details.symbol` marks the fresh read as genuine (a
    // fallback read returns an empty symbol), so a differing decimals is
    // adopted only from a real read. (Deferred edge: a token whose `decimals()`
    // alone returns null while name/symbol succeed keeps the fetcher's
    // substituted 18 — its symbol is non-empty so it skips this heal; catching
    // it needs the effect to surface `usedDefault`. Out of scope for this P3
    // fix; #736's bytecode/decimals probe filters most such tokens.)
    const freshDecimals = BigInt(details.decimals);
    if (
      !token.symbol &&
      !token.name &&
      details.symbol &&
      freshDecimals !== token.decimals
    ) {
      overlay.decimals = freshDecimals;
    }
    if (
      overlay.symbol === undefined &&
      overlay.name === undefined &&
      overlay.decimals === undefined
    ) {
      return token;
    }
    const updated: Token = { ...token, ...overlay };
    context.Token.set(updated);
    return updated;
  } catch (error) {
    context.log.error(
      `Error refreshing token metadata for ${token.address} on chain ${chainId}: ${error}`,
    );
    return token;
  }
}
