import type { Token, handlerContext } from "generated";
import { estimateBlockAtTimestamp } from "./ChainBlockTime";
import { MS_IN_AN_HOUR, TEN_TO_THE_18_BI, TokenId } from "./Constants";
import {
  getTokenDetails,
  getTokenPrice,
  hasContractBytecode,
  roundBlockToInterval,
} from "./Effects/Index";
import { getRebindTarget, isBlacklistedToken } from "./PriceOverrides";
import { getGateDecisionFromSignals } from "./PriceTrust";
import { setTokenPriceSnapshot } from "./Snapshots/TokenPriceSnapshot";
export interface TokenPriceData {
  pricePerUSDNew: bigint;
  decimals: bigint;
}

// Issue #668: receiver-side guard against transient absurd oracle reads. The
// Fraxtal V3 oracle has historically returned values 15–30 OOM away from the
// surrounding baseline for sfrxETH and FXB20291231; persisting any one of
// those readings permanently poisons cumulative pool aggregates because
// volume/fees are append-only. We treat the on-chain oracle as untrusted
// input: any refresh whose ratio against the last accepted price exceeds
// 10× is rejected as long as the anchor is still fresh (≤ 14 days). See the
// issue body for the heuristic calibration.
const PRICE_SPIKE_RATIO_THRESHOLD = 10n;
const PRICE_SPIKE_STALENESS_MS = 14 * 24 * 60 * 60 * 1000;

// Issue #728: locked-anchor poisoning defense. The #668 spike guard needs a
// prior non-zero anchor to compare ≥10× against, so the very first non-zero
// oracle read has nothing to validate it. If that read is inflated, the
// locked anchor poisons every subsequent pool calc until the token is
// reactively blacklisted (see PR #722). Cap rejects any first non-zero anchor
// > $10K for non-BTC symbols. Empirical scan against the deployed indexer
// found zero legitimate non-BTC tokens ever priced above $10K — every >$10K
// observation was a known poison case handled by REBIND / BLACKLIST /
// stablecoin pin. BTC symbols (WBTC, cbBTC, SolvBTC, …) are exempt because
// they routinely price in the tens of thousands.
const FIRST_FETCH_CAP = 10_000n * TEN_TO_THE_18_BI;

// Issue #788: absolute price ceiling. The spike guard only protects a FRESH
// anchor (younger than PRICE_SPIKE_STALENESS_MS); once a token idles past that
// window its anchor is no longer trusted, so a read of ANY magnitude is
// accepted — BPX/BPX6900 booked a $7.17e18-per-token read after 26 days idle
// (the highest price the indexer has ever recorded). This is a hard upper
// bound applied to every read regardless of anchor age. $1M/token sits ~10×
// above BTC's range (WBTC ≈ $100K) and far below the $10^28 egregious-poison
// gate. An oracle-cache audit of the deployed indexer (commit c9b8978, 4.77M
// nonzero reads) found every persistent read above $1M to be an oracle glitch,
// never a legitimate price — so no real token (BTC variants included)
// approaches it, and no symbol exemption is needed, unlike FIRST_FETCH_CAP.
// Deliberately a loose backstop, not a tight bound: glitch plateaus in the
// $1K–$100K band — where legitimate high-value tokens also live — are left to
// the anchor-relative spike guard, which rejects them as ≥10× jumps against a
// fresh anchor. (The same audit showed re-anchoring those plateaus would
// poison ~250 tokens; see issues #784/#785 for why a mechanical re-anchor was
// rejected.)
const MAX_ACCEPTED_PRICE = 1_000_000n * TEN_TO_THE_18_BI;

// Two positive prices "agree" when neither exceeds the other by the spike
// ratio (10×) — the same loose band the upward spike guard uses. Reused by the
// pool-implied ground-truth checks (#784/#785) to ask whether an oracle read
// and a pool-implied hint corroborate each other. Zero on either side means
// "no usable signal" → never agrees.
const withinRatioBand = (a: bigint, b: bigint): boolean =>
  a > 0n &&
  b > 0n &&
  a <= b * PRICE_SPIKE_RATIO_THRESHOLD &&
  b <= a * PRICE_SPIKE_RATIO_THRESHOLD;

/**
 * Creates and persists a Token entity at first sight, gated on the address
 * actually being a contract on-chain.
 *
 * Issue #677: addresses with no deployed bytecode (EOAs, never-deployed
 * contracts) used to write Token rows with empty `symbol`/`name` from the
 * static fallback in {@link getTokenDetails}. The bytecode gate filters them
 * here so callers see `null` and can skip downstream work.
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
    pricePerUSDNew: BigInt(0),
    lastUpdatedTimestamp: blockDatetime,
    lastSuccessfulPriceTimestamp: undefined,
    isWhitelisted: false,
    priceTrustOutcome: decision.outcome,
    priceTrustReason: decision.reason,
  };

  context.Token.set(tokenEntity);
  return tokenEntity;
}

/**
 * Refreshes a token's price subject to a uniform 1-hour throttle, dispatching
 * to blacklist, cross-chain rebind, or on-chain oracle paths as configured.
 *
 * Two clocks are tracked independently (issue #694):
 *
 * - `lastUpdatedTimestamp` advances on EVERY refresh attempt (including $0
 *   reads and fallback writes). It drives the 1-hour throttle at the top of
 *   this function, ensuring we don't re-hit the oracle on every subsequent
 *   event for stuck tokens.
 * - `lastSuccessfulPriceTimestamp` advances ONLY when a non-zero price is
 *   persisted (main oracle write or rebind with a priced source). It drives
 *   the 7-day staleness window guarding the last-known-price fallback —
 *   so once a token enters fallback, the window can actually expire even
 *   with hourly retries. The fallback covers every oracle generation
 *   (#775 extended it from V3-only to V1/V2 too).
 *
 * When a caller supplies `impliedPriceHint` — a pool-implied USD price derived
 * from the counterparty leg's trusted price (see {@link getPoolImpliedUSD}) —
 * it acts as an independent ground-truth witness against a poisoned anchor:
 * a too-low first read is replaced by the hint (#785), and a stale-low anchor
 * is re-anchored when the incoming read corroborates the hint while the anchor
 * contradicts it (#784). Omitting the hint (the default) leaves every code
 * path identical to before.
 *
 * @param token - The token entity to refresh.
 * @param blockNumber - Block at which to fetch price (rounded to an hourly bucket for cache hits).
 * @param blockTimestamp - Block timestamp in seconds.
 * @param chainId - Chain the token lives on.
 * @param context - Envio handler context.
 * @param impliedPriceHint - Optional pool-implied USD price (1e18-base, same
 *   scaling as `pricePerUSDNew`) used as ground truth for the #784/#785 anchor
 *   checks. `undefined` / `0n` ⇒ no hint, behavior unchanged.
 * @returns The updated token entity (or the unchanged input when throttled).
 */
export async function refreshTokenPrice(
  token: Token,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
  impliedPriceHint?: bigint,
): Promise<Token> {
  const blockTimestampMs = blockTimestamp * 1000;
  // Pool-implied ground truth (#784/#785); 0n / undefined ⇒ no usable hint,
  // leaving every check below inert (behavior identical to a hint-free refresh).
  const hint = impliedPriceHint ?? 0n;

  // Issue #735: heal empty symbol/name on every refresh call regardless of the
  // 1-hour price-refresh throttle. Tokens whose pool was created during a
  // transient RPC failure (empty symbol) used to stay broken indefinitely
  // when the only events on the pool fell inside the throttle window after
  // creation; lifting heal above the throttle gate ensures the first
  // observation after creation clears the empty metadata. The heal is
  // idempotent — successive calls on a healed token short-circuit on the
  // `symbol && name` guard inside {@link healTokenMetadata}.
  const healed = await healTokenMetadata(token, chainId, context);

  // Issue #676: uniform 1-hour throttle for all tokens (regardless of current
  // price). RPC cost is bounded by the throttle plus Envio's hourly-rounded
  // effect cache key on `getTokenPrice`. Safe because we always bump
  // `lastUpdatedTimestamp` below, so the throttle advances even on $0 results.
  const shouldRefresh =
    !healed.lastUpdatedTimestamp ||
    blockTimestampMs - healed.lastUpdatedTimestamp.getTime() >= MS_IN_AN_HOUR;

  if (!shouldRefresh) {
    return healed;
  }

  // Issue #669: blacklist + canonical rebind override the oracle for known-bad
  // (chain, token) pairs. See src/PriceOverrides.ts for rationale per token.
  if (isBlacklistedToken(chainId, healed.address)) {
    const updated: Token = {
      ...healed,
      pricePerUSDNew: 0n,
      lastUpdatedTimestamp: new Date(blockTimestampMs),
    };
    context.Token.set(updated);
    return updated;
  }

  const rebindTarget = getRebindTarget(chainId, healed.address);
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
          // Issue #748: pass source decimals when the source Token entity is
          // already loaded so the gateway skips the source `fetchTokenDetails`
          // RPC. When sourceToken is undefined (truly cold-sync), omit so the
          // gateway falls back to fetching.
          tokenDecimals: sourceToken ? Number(sourceToken.decimals) : undefined,
        });
        sourcePrice = prefetched.pricePerUSDNew;
      }
    }

    const updated: Token = {
      ...healed,
      pricePerUSDNew: sourcePrice,
      lastUpdatedTimestamp: new Date(blockTimestampMs),
      lastSuccessfulPriceTimestamp:
        sourcePrice > 0n
          ? new Date(blockTimestampMs)
          : healed.lastSuccessfulPriceTimestamp,
    };
    context.Token.set(updated);
    if (sourcePrice > 0n) {
      setTokenPriceSnapshot(
        healed.address,
        chainId,
        blockNumber,
        new Date(blockTimestampMs),
        sourcePrice,
        healed.isWhitelisted,
        context,
      );
    }
    return updated;
  }

  try {
    // Round block number to nearest hour interval for better cache hits
    // Cache key is based on input parameters, so rounding must happen before effect call
    const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

    const priceData = await context.effect(getTokenPrice, {
      tokenAddress: healed.address,
      chainId,
      blockNumber: roundedBlockNumber,
      // Issue #748: source-token decimals come from the stored Token entity
      // (the same value downstream USD math consumes), so the gateway can
      // skip the source `fetchTokenDetails` RPC (~3 redundant eth_calls per
      // cache miss).
      tokenDecimals: Number(healed.decimals),
    });
    const currentPrice = priceData.pricePerUSDNew;

    // Issue #788: absolute ceiling — reject any read above MAX_ACCEPTED_PRICE
    // before the anchor-relative checks below, so it fires regardless of anchor
    // state (first-fetch, fresh, or stale). The prior anchor is preserved; we
    // only bump `lastUpdatedTimestamp` to re-arm the spike guard, so a smaller
    // follow-up read is validated against the (still-fresh) anchor instead of
    // slipping through the stale-anchor exemption — e.g. BPX's $7.17e18 read is
    // rejected here, and the $40,766 read three hours later is then caught by
    // the spike guard rather than accepted. No snapshot is written.
    if (currentPrice > MAX_ACCEPTED_PRICE) {
      context.log.info(
        `[MAX_PRICE_CEILING] chain=${chainId} address=${healed.address} symbol=${healed.symbol} proposed=${currentPrice} ceiling=${MAX_ACCEPTED_PRICE} — rejecting absurd read, keeping price=${healed.pricePerUSDNew}`,
      );
      const capped: Token = {
        ...healed,
        lastUpdatedTimestamp: new Date(blockTimestampMs),
      };
      context.Token.set(capped);
      return capped;
    }

    // Issue #785: FIRST_FETCH_CAP (#728) only guards a too-HIGH first read; a
    // too-LOW first read (LIFE: $0.0014 vs true ~$0.25) is accepted as the
    // anchor and then freezes every later correct read as an upward spike,
    // forever. When a trusted pool-implied hint exists at first sight, validate
    // the first nonzero read against it: if it is out of band (too-low or
    // too-high), anchor to the hint itself so the token recovers in a single
    // read instead of locking onto the bad value. An in-band first read falls
    // through and is accepted normally; a $0 read is left to the existing
    // last-known/normal path (retry next refresh) rather than eagerly anchored.
    //
    // A hint above MAX_ACCEPTED_PRICE (#788) is itself the signal of a glitched
    // pool ratio, so it is not usable ground truth: skip the override and let
    // the read take the normal first-fetch path rather than writing a >$1M
    // anchor that the ceiling at line 301 would reject from any other source.
    if (
      healed.pricePerUSDNew === 0n &&
      currentPrice > 0n &&
      hint > 0n &&
      hint <= MAX_ACCEPTED_PRICE &&
      !withinRatioBand(currentPrice, hint)
    ) {
      context.log.info(
        `[poolImpliedFirstFetch] chain=${chainId} address=${healed.address} symbol=${healed.symbol} firstRead=${currentPrice} hint=${hint} — first read out of band, anchoring to pool-implied hint`,
      );
      const anchored: Token = {
        ...healed,
        pricePerUSDNew: hint,
        lastUpdatedTimestamp: new Date(blockTimestampMs),
        lastSuccessfulPriceTimestamp: new Date(blockTimestampMs),
      };
      context.Token.set(anchored);
      setTokenPriceSnapshot(
        healed.address,
        chainId,
        blockNumber,
        new Date(blockTimestampMs),
        hint,
        healed.isWhitelisted,
        context,
      );
      return anchored;
    }

    // Issue #728: cap-reject the first non-zero anchor for non-BTC symbols.
    // The spike guard below requires anchor > 0, so without this gate a single
    // inflated read at first sight permanently poisons the anchor. Bumping
    // `lastUpdatedTimestamp` keeps the 1-hour throttle ticking so the next
    // refresh retries. Conditions are ordered so the cheap bigint compares
    // short-circuit before the symbol string allocation on the hot path.
    if (
      healed.pricePerUSDNew === 0n &&
      currentPrice > FIRST_FETCH_CAP &&
      !healed.symbol.toUpperCase().includes("BTC")
    ) {
      context.log.warn(
        `[FIRST_FETCH_CAP] chain=${chainId} address=${healed.address} symbol=${healed.symbol} proposed=${currentPrice} cap=${FIRST_FETCH_CAP} — rejecting first anchor write, keeping price=0`,
      );
      const capped: Token = {
        ...healed,
        pricePerUSDNew: 0n,
        lastUpdatedTimestamp: new Date(blockTimestampMs),
      };
      context.Token.set(capped);
      return capped;
    }

    // Issue #668: reject upward refreshes that jump ≥10× vs a still-fresh
    // accepted anchor. First-fetch (anchor == 0) and stale-anchor (anchor
    // older than PRICE_SPIKE_STALENESS_MS) are exempt — neither shape can
    // be a transient oracle glitch poisoning a previously-good baseline.
    //
    // Issue #730: the guard is upward-only. The two directions have
    // asymmetric failure costs:
    //
    // - Upward false-accept (candidate wrongly high) is brief; the next
    //   refresh self-heals once the oracle returns to baseline.
    // - Downward false-reject (anchor wrongly high, candidate correct) is
    //   permanent; every subsequent correct reading keeps getting rejected
    //   and the inflated anchor is held forever (DTF kept $8.18 vs
    //   DefiLlama $0.0008466 for 111 days).
    //
    // Also returns early on rejection rather than writing back — the
    // earlier fall-through bumped `lastUpdatedTimestamp` on every rejected
    // refresh, resetting `anchorAgeMs` so the 14-day exit was unreachable.
    // Same fix shape PR #696 applied to the V3 fallback path for #694.
    const anchorPrice = healed.pricePerUSDNew;
    const anchorAgeMs = healed.lastUpdatedTimestamp
      ? blockTimestampMs - healed.lastUpdatedTimestamp.getTime()
      : Number.POSITIVE_INFINITY;
    const upwardSpike =
      anchorPrice > 0n &&
      currentPrice >= anchorPrice * PRICE_SPIKE_RATIO_THRESHOLD;
    if (upwardSpike && anchorAgeMs < PRICE_SPIKE_STALENESS_MS) {
      // Issue #784: a downward glitch can poison the anchor (e.g. YGG read
      // $0.0026 vs true $0.14), after which the upward-only guard rejects
      // every correct heal for the full staleness window. When a trusted
      // pool-implied hint corroborates the incoming read AND contradicts the
      // stored anchor, the *anchor* is the outlier — re-anchor to the read
      // instead of rejecting. The pool state is an independent witness (not the
      // oracle route that produced the bad anchor), so it distinguishes a
      // stuck-low anchor from a genuine transient spike — the discriminator the
      // #801 cache audit showed a time-based re-anchor lacked.
      const poolImpliedReanchor =
        withinRatioBand(currentPrice, hint) &&
        !withinRatioBand(anchorPrice, hint);
      if (!poolImpliedReanchor) {
        context.log.warn(
          `[priceSpikeRejected] ${healed.address} chain=${chainId} anchor=${anchorPrice} candidate=${currentPrice}`,
        );
        return healed;
      }
      context.log.info(
        `[poolImpliedReanchor] ${healed.address} chain=${chainId} anchor=${anchorPrice} candidate=${currentPrice} hint=${hint} — re-anchoring past stuck-low anchor`,
      );
    }

    // If price fetch returned 0, it could mean:
    // 1. No price path exists in the oracle (token not configured)
    // 2. Historical state unavailable (RPC limitation)
    //
    // If we have a previous non-zero price, use it as fallback.
    // This works in harmony with Envio's effect caching - if the effect cache has a previous
    // successful result, it will be used. But if it returns 0, we fall back to the token's stored price.
    //
    // Issue #694: gate the staleness window on `lastSuccessfulPriceTimestamp`,
    // not `lastUpdatedTimestamp`. The latter advances on every attempt
    // (including fallback writes), which previously made the window
    // effectively never expire while a token was stuck in fallback.
    const shouldUseLastKnownPrice =
      currentPrice === 0n &&
      healed.pricePerUSDNew > 0n &&
      healed.lastSuccessfulPriceTimestamp &&
      // Only use last known price if the LAST SUCCESSFUL write is relatively
      // recent (within 7 days). This prevents using very stale prices but
      // allows for temporary oracle issues.
      blockTimestampMs - healed.lastSuccessfulPriceTimestamp.getTime() <
        7 * 24 * 60 * 60 * 1000;

    // Last-known-price fallback: every oracle generation throws transient $0
    // reads (V3 from on-chain reverts; V1/V2 additionally when the RpcGateway
    // returns its `{pricePerUSDNew: 0n, usedDefault: true}` fallback constant
    // on RPC outage). Preserve a fresh anchor across any of those cases. The
    // 7-day window on `lastSuccessfulPriceTimestamp` (#694) still bounds how
    // long we'll pin a stale value. Originally gated to V3 only (#694); the
    // V1/V2 exposure was confirmed in #775 (~$250M of Optimism volume zeroed).
    if (shouldUseLastKnownPrice) {
      const updatedToken: Token = {
        ...healed,
        lastUpdatedTimestamp: new Date(blockTimestampMs),
        // lastSuccessfulPriceTimestamp deliberately NOT bumped: this write
        // doesn't represent a fresh oracle success (#694).
      };
      context.Token.set(updatedToken);
      return updatedToken;
    }

    const updatedToken: Token = {
      ...healed,
      pricePerUSDNew: currentPrice,
      lastUpdatedTimestamp: new Date(blockTimestampMs),
      lastSuccessfulPriceTimestamp:
        currentPrice > 0n
          ? new Date(blockTimestampMs)
          : healed.lastSuccessfulPriceTimestamp,
    };
    context.Token.set(updatedToken);

    setTokenPriceSnapshot(
      healed.address,
      chainId,
      blockNumber,
      new Date(blockTimestampMs),
      currentPrice,
      healed.isWhitelisted,
      context,
    );
    return updatedToken;
  } catch (error) {
    context.log.error(
      `Error refreshing token price for ${healed.address} on chain ${chainId}: ${error}`,
    );
    // Return healed token if price refresh fails — metadata heal still applies.
    return healed;
  }
}

/**
 * Re-fetches ERC20 metadata when the stored Token entity has an empty symbol or
 * name (issues #672, #735). `createTokenEntity` calls `getTokenDetails` exactly
 * once per pool's `PoolCreated` event, so a transient RPC failure persists `?`
 * (empty symbol) on the Token forever.
 *
 * Exported so callers can heal outside the price-refresh path (issue #735):
 * `refreshTokenPrice` runs this above the 1-hour throttle so the first Swap /
 * Mint / Burn / Voter event after a pool's creation clears empty metadata,
 * even when the event lands inside the throttle window. The standalone export
 * keeps the door open for non-refresh handlers to call heal directly.
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
 * @returns The healed Token entity (with overlaid `symbol`/`name`) when fresh
 *          values were available; the original `token` reference otherwise.
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
    const overlay: { symbol?: string; name?: string } = {};
    if (!token.symbol && details.symbol) overlay.symbol = details.symbol;
    if (!token.name && details.name) overlay.name = details.name;
    if (overlay.symbol === undefined && overlay.name === undefined) {
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
