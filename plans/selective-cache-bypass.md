# Plan: Selective Cache Bypass for Historical $0 Token Prices

> Source PRD: Grill session discussion on fixing historical $0 prices caused by dead oracle connectors on affected chains (Celo, Swell, Fraxtal, Soneium)

## Architectural decisions

Durable decisions that apply across all phases:

- **No schema changes**: Uses existing Token entity fields (`pricePerUSDNew`, `lastUpdatedTimestamp`). No new entities or fields.
- **No new effects**: Uses existing `getTokenPrice` (cached) and `rpcGateway` (uncached). No duplicate effects created.
- **Cache control mechanism**: `context.cache = false` inside the `getTokenPrice` effect handler. Same pattern already used in `handleEffectErrorReturn` (Helpers.ts:145).
- **Affected chains**: A constant set of chain IDs (Celo, Swell, Fraxtal, Soneium) in Constants.ts. Explicitly temporary — remove after one full reindex with fixed connectors.
- **Backoff window**: 30 days for Change B. Chosen to accommodate slow-bootstrapping chains (Soneium, Superseed, Metal) while still bounding RPC waste.
- **Development approach**: TDD — tests written before implementation for each change.

## Context

The Envio HyperIndex effect cache (`cache: true` on `getTokenPrice`) caches results keyed by `{tokenAddress, chainId, blockNumber}`. Once cached, the handler never re-executes for those inputs. Dead oracle connectors on some chains caused $0 prices to be cached permanently. The stablecoin hardcode (PR #587) fixes stablecoins, but non-stablecoin tokens (e.g., CELO on Celo) still have stale $0 entries.

### Call stack

```
refreshTokenPrice (PriceOracle.ts)
  └─ shouldRefresh? → decides whether to fetch
  └─ context.effect(getTokenPrice, {...})
       └─ [EFFECT CACHE] → if hit, returns cached result, handler never runs
       └─ if miss → handleGetTokenPrice (RpcGateway.ts) → oracle RPC call
```

### Key behaviors

- `context.cache = false` prevents cache WRITE but not cache READ
- `rpcGateway` effect has `cache: false` — always makes real RPC calls
- Each block interval is processed once per deployment (checkpoint-based)
- The 7-day fallback in PriceOracle.ts uses last known non-zero price for V3 oracle failures

---

## Phase 1: Don't cache $0 price results (Change A)

**User stories**: Future connector breakages self-heal without code changes; new tokens that temporarily return $0 don't get permanently stuck in cache

### What to build

Modify the `getTokenPrice` effect handler so that when the oracle returns a $0 price, `context.cache = false` is set before returning. The $0 result is still returned to the caller (computation continues normally), but it's not persisted in the effect cache. Next time the same inputs are queried, it's a cache miss and the handler re-executes.

Non-zero results continue to be cached normally (default behavior).

This is a permanent improvement — prevents the root cause from recurring for any future connector issues on any chain.

### Acceptance criteria

- [ ] When oracle returns $0, the result is returned but NOT cached (context.cache = false)
- [ ] When oracle returns non-zero price, the result IS cached (default behavior preserved)
- [ ] Existing error handling (handleEffectErrorReturn) continues to work unchanged
- [ ] Stablecoin and destination token early-returns are unaffected (they always return non-zero)
- [ ] Tests written first (TDD): test that $0 results set context.cache = false, test that non-zero results don't

---

## Phase 2: 30-day backoff for persistently unpriceable tokens (Change B)

**User stories**: Legitimately unpriceable tokens (no oracle path, dead shitcoins) stop wasting RPC calls after 30 days; system doesn't retry forever

### What to build

Modify the `shouldRefresh` logic in `refreshTokenPrice` so that tokens with `pricePerUSDNew === 0n` for more than 30 days stop being retried. The existing `shouldRefresh` always retries when price is $0 — add a time-bound check.

New logic:
- Price is $0 AND token existed < 30 days with $0 → retry (might self-heal)
- Price is $0 AND token existed > 30 days with $0 → stop retrying (accepted as unpriceable)
- Price is non-zero AND > 1 hour since last update → normal hourly refresh
- Price is non-zero AND < 1 hour → skip

This is a permanent improvement — bounds the RPC cost of unpriceable tokens at ~720 calls (30 days x 24 hours) then zero.

### Acceptance criteria

- [ ] Tokens with $0 price for < 30 days continue to be retried every hour
- [ ] Tokens with $0 price for > 30 days are NOT retried (shouldRefresh returns false)
- [ ] Tokens with non-zero price follow the existing 1-hour refresh interval
- [ ] Tokens with missing lastUpdatedTimestamp are always refreshed
- [ ] The 30-day window gives Change A enough time to self-heal from connector fixes
- [ ] Tests written first (TDD): test all four decision branches in shouldRefresh

---

## Phase 3: rpcGateway bypass for affected chains (Change C)

**User stories**: Historical $0 prices on Celo/Swell/Fraxtal/Soneium are corrected with per-hour accuracy using the now-fixed oracle connectors

### What to build

Add a bypass in `refreshTokenPrice` that fires after `getTokenPrice` returns a cached $0 on an affected chain. The bypass calls `rpcGateway` directly (which has `cache: false`) to get the real price from the fixed connectors.

Flow:
1. Call `getTokenPrice` (cached) → get result
2. If result is $0 AND chain is in `AFFECTED_CHAINS` → call `rpcGateway` (uncached) → use fresh result
3. Else → use cached result

Define `AFFECTED_CHAINS` as a `Set<number>` in Constants.ts containing chain IDs for Celo, Swell, Fraxtal, and Soneium.

This is explicitly temporary — remove after one full reindex with fixed connectors. Add a comment explaining the lifecycle.

### Acceptance criteria

- [ ] AFFECTED_CHAINS constant defined with Celo, Swell, Fraxtal, Soneium chain IDs
- [ ] Bypass fires when getTokenPrice returns $0 AND chain is affected
- [ ] Bypass does NOT fire when getTokenPrice returns non-zero (even on affected chains)
- [ ] Bypass does NOT fire on unaffected chains (Base, Optimism, etc.)
- [ ] Bypass calls rpcGateway directly, producing correct per-hour historical prices
- [ ] Bypass result is used to update token entity with correct price
- [ ] Code includes clear comment marking this as temporary migration code
- [ ] Tests written first (TDD): test bypass triggers, test bypass skips, test unaffected chains untouched

---

## Verification

After all three phases:
- [ ] Run price verification script on affected chains for early + recent blocks
- [ ] Verify CELO token shows correct monthly prices (May 2025 onwards)
- [ ] Verify unaffected chains (Base, Optimism) show identical results to before
- [ ] Run full test suite: `pnpm test`
- [ ] Run QA: `pnpm qa --write`
