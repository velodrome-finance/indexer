import type { Token } from "envio";
import { TokenId } from "./Constants";
import {
  getCanonicalPriceSettings,
  getCanonicalSourcePrice,
  getTokenDetails,
  hasContractBytecode,
} from "./Effects/Index";
import { getRehydrated } from "./EntityTimestamps";
import type { handlerContext } from "./EntityTypes";
import type { Pool } from "./EntityTypes";
import { getCanonicalSource, isBlacklistedToken } from "./PriceOverrides";
import { getGateDecisionFromSignals } from "./PriceTrust";
import { lookupCanonicalSeedPrice } from "./Pricing/CanonicalPriceSeed";
import {
  type PricingCandidate,
  buildPricingCandidate,
  combineTwoHopCandidate,
  selectPricingCandidate,
} from "./Pricing/PoolRoute";
import {
  type PriceResolution,
  applyPriceResolution,
  isCounterpartyPriceFresh,
  isPriceRefreshDue,
} from "./Pricing/PriceResolution";
import {
  MAX_TWO_HOP_PEER_POOLS,
  PRICE_REFRESH_INTERVAL_MS,
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
 * @returns `pricePerUSDNew`, `lastSuccessfulPriceTimestamp` and
 *   `pricingDepthUSD` (always unset at creation) for the new row
 */
export function initialTokenPriceFields(
  chainId: number,
  address: string,
  createdAt: Date,
): Pick<
  Token,
  "pricePerUSDNew" | "lastSuccessfulPriceTimestamp" | "pricingDepthUSD"
> {
  const pinned = isBlacklistedToken(chainId, address)
    ? undefined
    : getPinnedPrice(chainId, address);
  return pinned
    ? {
        pricePerUSDNew: pinned,
        lastSuccessfulPriceTimestamp: createdAt,
        pricingDepthUSD: undefined,
      }
    : {
        pricePerUSDNew: 0n,
        lastSuccessfulPriceTimestamp: undefined,
        pricingDepthUSD: undefined,
      };
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
    isListedOnAero: undefined,
    priceTrustOutcome: decision.outcome,
    priceTrustReason: decision.reason,
  };

  context.Token.set(tokenEntity);
  return tokenEntity;
}

/**
 * Refreshes a token's USD price from indexed pool state, at most once per
 * token per clock hour (docs/adr/0003-pool-derived-token-prices.md,
 * docs/adr/0009-per-chain-entities.md flow F). No RPC is involved: the price
 * comes from this chain's entities, the committed seed and, for a canonical
 * source on another chain, this deployment's ClickHouse.
 *
 * Resolution order on a due refresh:
 *
 * 1. Operator blacklist (src/PriceOverrides.ts) → 0 (`override`).
 * 2. Tier 0 (destination token / stablecoins) → exactly $1 (`pinned`).
 * 3. Local pools, deepest qualifying one wins: every pool registered for the
 *    token in `TokenPricingPools` (counterparty in a strictly lower tier)
 *    offers pool ratio × counterparty USD price, at the counterparty-side
 *    depth. Each counterparty is refreshed first when it is itself due, and a
 *    counterparty whose last success is more than 2 h old (it is only
 *    carrying) is skipped, so the token is never priced off a stale base; the
 *    tier rule bounds that recursion at three levels. A candidate must pass
 *    the chain's depth floor, the 1000× imbalance bound and the $1M ceiling
 *    (`pool`).
 * 3b. A token with a canonical source on another chain (src/PriceOverrides.ts:
 *    WETH on ETH-equivalent leaf chains → Optimism WETH, XVELO → Optimism
 *    VELO, …), when nothing in step 3 qualified: the committed hourly seed's
 *    price of the source for this block's hour, if the seed covers it
 *    (`canonical-seed`, ADR 0008). The source chain's `Token` is never read
 *    (per-chain entities, ADR 0009).
 * 3c. Same case, the seed has no hour: the source's own hourly
 *    `TokenPriceSnapshot` for the last complete hour before this block, read
 *    from ClickHouse by the cached cross-chain `getCanonicalSourcePrice`
 *    effect once that hour is settled at the source (`canonical-snapshot`,
 *    ADR 0009 flow F). Off with `PRICING_CANONICAL_SNAPSHOT_EFFECT=false` or
 *    without ClickHouse settings.
 * 4. Tier-2 and tier-3 tokens only, when nothing in step 3 qualified: two-hop
 *    routes (ADR 0007). Each registered pool against another token C of the
 *    same tier (a peer pool) offers pool ratio × C's direct price, where C's direct price is
 *    computed now from C's own direct pool candidates (step 3 without peers or
 *    the canonical source). C's stored price is never used, so a carried or
 *    itself-two-hop C cannot extend a chain. The weaker of the two hops sets
 *    the depth for the floor, the imbalance bound and the comparison
 *    (`pool`, `pricingHops = 2`).
 * 5. Nothing qualified: carry the last price (`carried`) while its last
 *    success is under 7 days old, whatever the tier, else 0 (`unpriced`).
 *
 * Two clocks (#694): `lastUpdatedTimestamp` advances on every due refresh
 * (it is the throttle); `lastSuccessfulPriceTimestamp` only on steps 2–3.
 * `pricingDepthUSD` stores the winning pool depth.
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

  if (!context.isPreload) {
    // The batch's preload pass is over; its memo must not outlive it.
    if (preloadRefreshes.size > 0) preloadRefreshes.clear();
    return refreshDueTokenPrice(
      healed,
      blockNumber,
      blockTimestamp,
      chainId,
      context,
    );
  }

  // Preload pass: writes are discarded, so the Token.set below never lands and
  // every event of the batch touching this token in this clock hour would see
  // it as due and redo the whole resolution. The run proper refreshes it once
  // (later events see the written row and are throttled), so resolve each
  // (token, hour, stored state) once here too: the first call issues the loads
  // the run proper needs, the rest share its result.
  const key = `${healed.id}|${Math.floor(blockTimestampMs / PRICE_REFRESH_INTERVAL_MS)}|${healed.lastUpdatedTimestamp?.getTime() ?? ""}`;
  const pending = preloadRefreshes.get(key);
  if (pending) return pending;
  if (preloadRefreshes.size >= PRELOAD_REFRESH_MEMO_LIMIT) {
    preloadRefreshes.clear();
  }
  const refresh = refreshDueTokenPrice(
    healed,
    blockNumber,
    blockTimestamp,
    chainId,
    context,
  );
  preloadRefreshes.set(key, refresh);
  return refresh;
}

/**
 * Whether {@link refreshTokenPrice} would return `token` unchanged without any
 * read or write: its metadata is complete (so the heal is skipped) and its
 * price is not due this clock hour. Exact by
 * construction — these are the conditions under which `refreshTokenPrice`
 * returns its input — so a caller may skip the async call when it holds.
 *
 * @param token - The token as loaded by the caller
 * @param blockTimestamp - Block timestamp in seconds
 * @param chainId - Chain of the triggering event
 * @returns true when calling `refreshTokenPrice` would be a no-op
 */
export function isTokenRefreshNoop(
  token: Token,
  blockTimestamp: number,
  chainId: number,
): boolean {
  return (
    Boolean(token.symbol && token.name) &&
    !isPriceRefreshDue(token.lastUpdatedTimestamp, blockTimestamp * 1000)
  );
}

/**
 * Preload-pass memo of due refreshes, keyed by token id, clock hour and the
 * token's stored `lastUpdatedTimestamp`. Cleared by the first run-proper
 * refresh (envio runs a batch's preload pass to completion before its handlers
 * run), and bounded in case a batch has no run-proper refresh at all.
 */
const preloadRefreshes = new Map<string, Promise<Token>>();
const PRELOAD_REFRESH_MEMO_LIMIT = 50_000;

/**
 * The due-refresh body of {@link refreshTokenPrice}: resolve, apply, write the
 * Token and its TokenPriceSnapshot.
 *
 * @param healed - The token (metadata already healed), known to be due
 * @param blockNumber - Block of the triggering event
 * @param blockTimestamp - Block timestamp in seconds
 * @param chainId - Chain the token lives on
 * @param context - Envio handler context
 * @returns The refreshed token
 */
async function refreshDueTokenPrice(
  healed: Token,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<Token> {
  const blockTimestampMs = blockTimestamp * 1000;
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
      pricingSourceTokenId: applied.pricingSourceTokenId,
      pricingDepthUSD: applied.pricingDepthUSD,
      pricingHops: applied.pricingHops,
      pricingViaTokenId: applied.pricingViaTokenId,
      pricingViaPoolId: applied.pricingViaPoolId,
      lastSuccessfulPriceTimestamp: applied.token.lastSuccessfulPriceTimestamp,
      pricingSeedHour: applied.pricingSeedHour,
    },
    context,
  );
  return applied.token;
}

/**
 * Decides how a due refresh prices `token` (steps 1–3 of
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

  const minDepthUSD = getMinPricingDepthUSD(chainId);
  const pools = await loadRegisteredPools(token, context);
  const poolCandidates = await findPoolCandidates(
    token,
    tier,
    pools,
    blockNumber,
    blockTimestamp,
    chainId,
    context,
  );
  let best = selectPricingCandidate(poolCandidates, minDepthUSD);
  const canonical = getCanonicalSource(chainId, token.address);
  if (!best && canonical) {
    // No local pool qualified: the committed hourly seed's price of the
    // canonical source for this block's hour, if the seed covers it (ADR 0008).
    const sourceId = TokenId(canonical.chainId, canonical.address);
    const seed = lookupCanonicalSeedPrice(sourceId, blockTimestamp * 1000);
    if (seed) {
      return {
        kind: "seed",
        priceUSD: seed.priceUSD,
        sourceId,
        seedHourMs: seed.hourMs,
      };
    }
    // Past the seed's end: the source's own hourly snapshot from ClickHouse
    // (ADR 0009, flow F).
    const snapshot = await findCanonicalSnapshotPrice(
      token,
      sourceId,
      blockTimestamp * 1000,
      context,
    );
    if (snapshot) {
      return {
        kind: "snapshot",
        priceUSD: snapshot.priceUSD,
        sourceId,
        seedHourMs: snapshot.sourceHourMs,
      };
    }
  }
  if (
    !best &&
    (tier === PRICING_TIER.OTHER || tier === PRICING_TIER.CONNECTOR)
  ) {
    best = selectPricingCandidate(
      await findTwoHopCandidates(
        token,
        tier,
        pools,
        blockNumber,
        blockTimestamp,
        chainId,
        context,
      ),
      minDepthUSD,
    );
  }
  if (!best) return { kind: "none" };
  return {
    kind: best.kind,
    priceUSD: best.priceUSD,
    sourceId: best.sourceId,
    depthUSD: best.depthUSD,
    hops: best.hops,
    viaTokenId: best.viaTokenId,
    viaPoolId: best.viaPoolId,
  };
}

/**
 * Loads every pool registered for `token` in `TokenPricingPools` (direct and
 * peer pools alike), in registration order.
 *
 * @param token - The token whose pools to load
 * @param context - Envio handler context
 * @returns The pools that still exist
 */
async function loadRegisteredPools(
  token: Token,
  context: handlerContext,
): Promise<Pool[]> {
  const registered = await context.TokenPricingPools.get(token.id);
  const poolIds = registered?.pools ?? [];
  if (poolIds.length === 0) return [];
  return (
    await Promise.all(
      poolIds.map((id) => getRehydrated(context.Pool, "Pool", id)),
    )
  ).filter((pool): pool is Pool => pool !== undefined);
}

/**
 * The other token of `pool`, seen from `token`.
 *
 * @param pool - A pool containing `token`
 * @param token - The token being priced
 * @returns The counterparty's token id and address
 */
function counterpartyOf(
  pool: Pool,
  token: Token,
): { id: string; address: string } {
  const id = pool.token0_id === token.id ? pool.token1_id : pool.token0_id;
  // A token id is `{chainId}-{address}`; the address never contains `-`.
  return { id, address: id.slice(id.indexOf("-") + 1) };
}

/**
 * Two-hop candidates for a tier-2 or tier-3 token T (ADR 0007): one per
 * registered pool whose counterparty C is in T's own tier, valuing C at its
 * *direct* price, computed now from C's own direct pool candidates (never C's
 * peers, never its canonical source, never its stored price). C's direct route
 * therefore cannot itself be two-hop or carried, and computing it never
 * re-enters T or any other token of that tier, so the extension adds exactly
 * one level and stays acyclic. A blacklisted C is skipped.
 *
 * @param token - The token being priced
 * @param tier - The token's pricing tier (`CONNECTOR` or `OTHER`)
 * @param pools - The token's registered pools (from {@link loadRegisteredPools})
 * @param blockNumber - Block of the triggering event
 * @param blockTimestamp - Block timestamp in seconds
 * @param chainId - Chain the token lives on
 * @param context - Envio handler context
 * @returns One weakest-link candidate per usable peer pool, in registration order
 */
async function findTwoHopCandidates(
  token: Token,
  tier: PricingTier,
  pools: readonly Pool[],
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<PricingCandidate[]> {
  const peerPools = pools
    .filter(
      (pool) =>
        getPricingTier(chainId, counterpartyOf(pool, token).address) === tier,
    )
    .slice(0, MAX_TWO_HOP_PEER_POOLS);
  if (peerPools.length === 0) return [];

  const minDepthUSD = getMinPricingDepthUSD(chainId);
  const peerIds = [
    ...new Set(peerPools.map((pool) => counterpartyOf(pool, token).id)),
  ];
  const peers = await Promise.all(
    peerIds.map((id) => getRehydrated(context.Token, "Token", id)),
  );
  const routes = await Promise.all(
    peers.map(async (peer) => {
      if (!peer || isBlacklistedToken(chainId, peer.address)) return undefined;
      const peerCandidates = await findPoolCandidates(
        peer,
        tier,
        await loadRegisteredPools(peer, context),
        blockNumber,
        blockTimestamp,
        chainId,
        context,
      );
      const via = selectPricingCandidate(peerCandidates, minDepthUSD);
      return via ? { peer, via } : undefined;
    }),
  );
  const routeByPeerId = new Map(
    routes
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => [r.peer.id, r]),
  );

  const candidates: PricingCandidate[] = [];
  for (const pool of peerPools) {
    const route = routeByPeerId.get(counterpartyOf(pool, token).id);
    if (!route) continue;
    const hop = buildPricingCandidate(pool, token, {
      decimals: route.peer.decimals,
      pricePerUSDNew: route.via.priceUSD,
    });
    if (hop) {
      candidates.push(combineTwoHopCandidate(hop, route.via, route.peer.id));
    }
  }
  return candidates;
}

/**
 * Builds the direct candidates among a token's registered pools: those whose
 * counterparty sits in a strictly lower tier. Loads the counterparties,
 * refreshes each one that is due, and builds one candidate per pool. Reads are
 * issued together with `Promise.all` so Envio's preload pass batches them.
 *
 * Counterparties are re-checked against the tier rule here as well as at
 * registration, so even a stale or hand-edited `TokenPricingPools` row cannot
 * make the recursion cyclic.
 *
 * @param token - The token being priced
 * @param tier - The token's pricing tier
 * @param registeredPools - The token's registered pools
 * @param blockNumber - Block of the triggering event
 * @param blockTimestamp - Block timestamp in seconds
 * @param chainId - Chain the token lives on
 * @param context - Envio handler context
 * @returns One candidate per usable direct pool (selection happens in the caller)
 */
async function findPoolCandidates(
  token: Token,
  tier: PricingTier,
  registeredPools: readonly Pool[],
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<PricingCandidate[]> {
  const pools = registeredPools.filter(
    (pool) =>
      getPricingTier(chainId, counterpartyOf(pool, token).address) < tier,
  );
  if (pools.length === 0) return [];

  const counterpartyIdOf = (pool: Pool): string =>
    counterpartyOf(pool, token).id;
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
  // A route is only as fresh as its base: a counterparty that is only
  // carrying an old price (its own routes failed) cannot set this token's
  // price; the token carries its own last price instead.
  const blockTimestampMs = blockTimestamp * 1000;
  const counterpartyById = new Map<string, Token>();
  for (const counterparty of refreshed) {
    if (
      counterparty &&
      (getPricingTier(chainId, counterparty.address) === PRICING_TIER.PINNED ||
        isCounterpartyPriceFresh(
          counterparty.lastSuccessfulPriceTimestamp,
          blockTimestampMs,
        ))
    ) {
      counterpartyById.set(counterparty.id, counterparty);
    }
  }

  const candidates: PricingCandidate[] = [];
  for (const pool of pools) {
    const counterparty = counterpartyById.get(counterpartyIdOf(pool));
    if (!counterparty) continue;
    const candidate = buildPricingCandidate(pool, token, counterparty);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/**
 * The canonical source's price for the last complete clock hour before this
 * block, from its hourly `TokenPriceSnapshot` in ClickHouse (the
 * `getCanonicalSourcePrice` effect, ADR 0009 flow F). Only reached for a token
 * with a canonical source when no local pool or live source qualified and the
 * seed has no hour, so it runs at most once per token per clock hour (the
 * refresh throttle; the preload pass shares the run's call through envio's
 * in-memory effect table). An unsettled hour is not cached, so a later
 * hour's refresh asks again. Any failure counts as no answer.
 *
 * @param token - The leaf token being priced
 * @param sourceId - Its canonical source token id
 * @param blockTimestampMs - Current block timestamp in milliseconds
 * @param context - Envio handler context
 * @returns The price and the source hour used, or undefined
 */
async function findCanonicalSnapshotPrice(
  token: Token,
  sourceId: string,
  blockTimestampMs: number,
  context: handlerContext,
): Promise<{ priceUSD: bigint; sourceHourMs: number } | undefined> {
  const settings = getCanonicalPriceSettings();
  if (!settings.snapshotEffect || !settings.clickhouse) return undefined;
  const hourMs =
    (Math.floor(blockTimestampMs / PRICE_REFRESH_INTERVAL_MS) - 1) *
    PRICE_REFRESH_INTERVAL_MS;
  try {
    const answer = await context.effect(getCanonicalSourcePrice, {
      sourceTokenId: sourceId,
      hourMs,
      requesterTokenId: token.id,
    });
    return answer.priceUSD > 0n ? answer : undefined;
  } catch (error) {
    context.log.warn(
      `[refreshTokenPrice] getCanonicalSourcePrice failed for ${token.id} (source ${sourceId}): ${error}`,
    );
    return undefined;
  }
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
