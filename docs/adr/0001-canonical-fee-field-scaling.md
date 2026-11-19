# ADR 0001: Canonical fee-field scaling across V2 and CL pools

- **Status:** Accepted (2026-06-02)
- **Issue:** [#812](https://github.com/velodrome-finance/indexer/issues/812)

## Context

The same `Pool` / `UserStatsPerPool` schema fields carried **different scales
depending on pool type**, so any cross-pool-type aggregation or interpretation
was wrong. Confirmed live on the deployed endpoint:

- **Token-amount fee fields** (`totalFeesGenerated0/1`, `totalFeesContributed0/1`):
  V2 (AMM) stored **raw** token units; CL stored **1e18-normalized**. A 0.50-USDC
  fee read as `~5e5` on V2 but `~5e17` on CL.
- **`baseFee` / `currentFee`**: V2 stored **basis points** (÷1e4, e.g. `30` = 0.30%);
  CL stored **hundredths-of-a-basis-point** (÷1e6, e.g. `3000` = 0.30%) — off by 100×.
  After issue #797 each path also had its own divisor (`V2_FEE_SCALE` = 1e4,
  `CL_FEE_SCALE` = 1e6), so a stored `100` meant 1% on V2 but 0.01% on CL.

## Decision

Adopt CL's scales as canonical so an equivalent fee reads identically on both paths:

1. **Token-amount fee fields are 1e18-normalized** on both V2 and CL. V2's
   `Pool.Fees` amounts are normalized at write via `normalizeTokenAmountTo1e18`
   (CL already did this). This is the house convention for cross-token comparability.
2. **`baseFee` / `currentFee` use a single `FEE_SCALE = 1e6`** ("hundredths of a
   basis point"), with `V2_FEE_SCALE` and `CL_FEE_SCALE` merged into it — one
   divisor everywhere. On-chain V2 basis-point fees are lifted into `FEE_SCALE`
   at every write site via `toCanonicalFeeScale(rawFee, isCL)` (`isCL ? raw : raw × 100`).

`FEE_SCALE = 1e6` was chosen over unifying down to basis points because CL pools
use sub-basis-point dynamic fees (e.g. `9`, `313`, `2090` = 0.0009%, 0.0313%,
0.209% seen live) that ÷100 would truncate; 1e6 is lossless and matches both the
CL on-chain representation and what `getSwapFee` returns.

### Write-site routing

- V2 `PoolFactory` (PoolCreated defaults, SetCustomFee): bps → `toCanonicalFeeScale(fee, false)` (×100).
- `CustomSwapFeeModule.SetCustomFee`: routed through `toCanonicalFeeScale(fee, pool.isCL)` — correct whether it targets V2 or CL.
- `DynamicSwapFeeModule.CustomFeeSet`: confirmed CL-only (all `feeCap`/`scalingFactor` pools are `isCL`), already 1e6 — left untouched.
- CL `CLFactory` + `getSwapFee`: already 1e6 — unchanged.

## Consequences

- **No USD value changes.** Token-amount fields are separate from the `*USD`
  fields; for fees, the V2 rate is ×100 *and* the divisor is ×100, so
  `volumeUSD × fee / FEE_SCALE` is unchanged.
- **Breaking for external consumers of V2 `baseFee`/`currentFee`:** a V2 pool's
  served fee changes from e.g. `30`→`3000`; consumers reading it as basis points
  must switch to ÷`FEE_SCALE` (1e6). This is the one outward-facing change.
- Parity is pinned by `test/EventHandlers/FeeFieldScaling.test.ts`.

## Amendment (2026-11): CL fees derived from the swap; custom-fee sentinels

The scale is unchanged. What changed is where the CL rate comes from, and what
`baseFee` / `currentFee` mean on CL pools.

**Before.** Every CL pool's `currentFee` was refreshed by an archive `eth_call`
(`CLFactory.getSwapFee(pool)`, effect `getSwapFee`) once per pool per active
hour, at the snapshot boundary, and each swap's fee was `amountIn × currentFee`.
That was the dominant RPC cost of a sync, it lagged dynamic-fee pools by up to
about two hours (the refresh ran after the triggering swap was priced), and the
start-of-hour read could overwrite a fee an earlier event in the same batch had
just set.

**Now.** A Slipstream swap takes `principal + fee` on the input token, and the
fee never moves the price. The Swap handler already integrates the price move
over the pool's tick map (`processTickCrossings(…, "total")`), which gives the
principal, so `feeIn = amountIn − principalIn` exactly
(`src/Aggregators/CLSwapFee.ts`). `totalFeesGenerated0/1/USD` and the user's
`totalFeesContributed0/1/USD` come from that difference; the USD value is the
input leg's trusted USD × `feeIn / amountIn`. No CL handler calls `getSwapFee`;
the effect is kept only for `scripts/smoke-effects.ts`.
`scripts/verify-cl-fee-derivation.ts` checked the derivation against the
factory's `getSwapFee` on static- and dynamic-fee pools on Base and Optimism.

Drift guard: if the walk's ending in-range liquidity differs from the event's
`liquidity`, or the derived fee is negative or above 10% of `amountIn`, that
swap is valued with the stored rate (`currentFee ?? baseFee`) instead,
`Pool.numberOfSwapFeeFallbacks` is incremented, and the pool's first such swap
logs one `[CL_SWAP_FEE_FALLBACK]` warning.

Field meanings (FEE_SCALE 1e6 throughout):

| Field | V2 pool | CL pool |
| --- | --- | --- |
| `baseFee` | configured fee (factory default or `SetCustomFee`) | configured nominal fee: tick-spacing default, `CustomSwapFeeModule` fee, or `DynamicSwapFeeModule` custom base fee (a dynamic pool charges this plus a TWAP-volatility part, up to `feeCap`) |
| `currentFee` | = `baseFee` | effective rate of the latest swap with `amountIn ≥ 1e7` raw units, `feeIn / amountIn` rounded to nearest; smaller swaps are too coarse to measure a rate and leave it unchanged. Seeded from `baseFee` at creation and by `CustomSwapFeeModule.SetCustomFee`; used as the fallback rate |

`PoolSnapshot.baseFee` / `currentFee` copy these at the hour boundary, so a CL
snapshot's `currentFee` is the rate the last sizeable swap before the boundary
paid (previously: a `getSwapFee` read at the hour's first block).

**Custom-fee sentinels.** On the V2 `PoolFactory`, the CL `CustomSwapFeeModule`
and the CL `DynamicSwapFeeModule`, `ZERO_FEE_INDICATOR()` is 420: a custom fee
of 420 charges 0%, and a custom fee of 0 means "no override, use the default"
(V2: the factory's stable / volatile fee; CL: `tickSpacingToFee`). Confirmed with
`scripts/verify-fee-sentinels.ts` (state-overridden `getFee` calls on Base and
Optimism). The three handlers now store what the contract charges
(`resolveCustomSwapFee` in `src/EventHandlers/SwapFeeModule/CustomSwapFeeSharedLogic.ts`)
instead of the raw value. As of 2026-11-13 no indexed chain has ever emitted
either value, so this changes no current data.

## Amendment (2026-11-13): V2 fees from the pool's Fees events

**Problem.** A V2 swap's fee USD was `input leg USD × (currentFee ?? baseFee)`,
and the stored rate only followed the Optimism / Base `PoolFactory.SetCustomFee`.
A superchain leaf `PoolFactory` delegates custom fees to a separate fee module
(its `feeModule()`, set by `FeeModuleChanged`) that the indexer did not follow,
so a pool whose fee that module changed kept the 5 / 30 bps default. Example:
Metal stable pool `0x173c249bd99d8c04ebf65f19039dbc1e94787cd2`, stored 5 bps,
charges 200 bps (`getFee` on-chain).

**Now.**

1. **Fee USD from the fee charged.** A V2 pool emits `Fees(sender, amount0,
   amount1)` for the fee it takes on each input token, before the swap's `Sync`
   and `Swap`, and no `Fees` when the fee is 0. The Fees handler adds the
   amounts to `V2SwapFeesInTx` (`{chainId}-{txHash}-{pool}`, Postgres-only
   scratch); the Swap handler reads it by primary key in both passes and deletes
   it. Pool `totalFeesGeneratedUSD` and the user's `totalFeesContributedUSD`
   are the fee legs' trusted USD when the input leg is credible, else the
   min-protected `volumeInUSD × feeIn / amountIn` (the #733 / #797 scam-token
   defence). Attribution is unchanged (the tx signer, #814). `Fees` keeps
   writing `totalFeesGenerated0/1` as before.
2. **`currentFee` is the effective rate**, as on CL pools: `feeIn / amountIn`
   of the latest swap with `amountIn ≥ 1e7` raw units, rounded to the nearest
   basis point (the pool floors `amountIn × fee / 10000`). `baseFee` stays the
   configured fee.
3. **`baseFee` follows every V2 fee source.** The fee modules are indexed as
   `V2CustomFeeModule` (`SetCustomFee(address indexed pool, uint256 indexed
   fee)`, basis points, 420 = 0%, 0 = default), and `SetDefaultFee` is indexed
   on the leaf `PoolFactory` (`SetDefaultFee(bool indexed stable, uint256)`)
   and the Aero stable / volatile factories (`SetDefaultFee(uint256)`) into
   `PoolFactoryDefaultFee`, which `PoolCreated` and a custom-fee reset to 0
   read. Factories that never emitted one (Optimism, Base) keep the 5 / 30 bps
   constants.

**Scan (HyperSync, 2026-11-13, every V2 factory on every indexed chain).**

| Chain | Factory `SetDefaultFee` | Fee module (`FeeModuleChanged`) | Module `SetCustomFee` events |
| --- | --- | --- | --- |
| Optimism, Base | none (hard-coded defaults; factory's own `SetCustomFee`, already indexed) | none | n/a |
| Metal | 5 / 30 at deployment only | `0x81c5…B362` | 3 (200, 100, 100 bps) |
| Fraxtal | 5 / 30 at deployment only | `0xc60a…2E31` | 4 (100, 1, 100, 15 bps) |
| Lisk | 5 / 30 at deployment only | `0x4453…a06B` | 1 |
| Swell | 5 / 30 at deployment only | `0x81c5…B362` | 2 |
| Celo | 5 / 30 at deployment only | `0x8d9c…07a7` | 0 |
| Soneium, Ink, Unichain, Superseed | 5 / 30 at deployment only | `0x81c5…B362` | 0 |
| Mode | 5 / 30 at deployment only | none (7 `SetCustomFee` on the factory itself, already indexed) | n/a |
| Aero factories (all chains) | 5 stable / 30 volatile at deployment only | Aero stable / volatile CustomFeeModules (already indexed) | as indexed |

Each leaf module's `ZERO_FEE_INDICATOR()` is 420 and is the factory's current
`feeModule()` (checked on Metal, Fraxtal, Lisk and Celo). The `Fees`-based
valuation does not depend on this list being complete: a module the indexer
misses leaves `baseFee` stale, but fee USD and `currentFee` stay right.

Field meanings for V2 pools after this amendment:

| Field | V2 pool |
| --- | --- |
| `baseFee` | configured fee: factory default (`PoolFactoryDefaultFee`, else 5 / 30 bps) or the latest `SetCustomFee` (factory or `V2CustomFeeModule`) |
| `currentFee` | effective rate of the latest swap with `amountIn ≥ 1e7` raw units, from its `Fees` amount; seeded from `baseFee` at creation and on `SetCustomFee` |

A `SetDefaultFee` after a pool's creation does not rewrite existing pools'
`baseFee` (that would need a scan of the factory's pools); none has happened.
