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
