# ADR 0002: Trust price-connector tokens for USD valuation

- **Status:** Accepted (2026-06-26)
- **Issue:** [#898](https://github.com/velodrome-finance/indexer/issues/898)

## Context

USD aggregates are gated by a price-trust system (#755): `getTrustedUSD` counts a
pool leg only when its token passes `isTrusted`, which keyed trust **solely** on
`isWhitelisted` — sourced from on-chain `WhitelistToken` events (`Voter` /
`SuperchainLeafVoter`) — minus an operator `BLACKLIST` override.

Verified live on the deployed endpoint (`21b81aa`):

- **Mode (34443)** and **Swell (1923)** captured **zero** `WhitelistToken`
  events (Mode is indexed from block 0, full history) → **every** USD field
  reads `$0` across the whole chain (`Pool.totalLiquidityUSD / totalVolumeUSD /
  totalFeesGeneratedUSD / …` and all `UserStatsPerPool` USD fields).
- **Soneium (1868)** and **Metal (1750)**: WETH (`0x4200…0006`) was never
  whitelisted, so every WETH-paired pool counted only its non-WETH leg
  (~half TVL/volume/fees), because
  `calculateTotalUSD = getTrustedUSD(leg0) + getTrustedUSD(leg1)` and an
  untrusted leg contributes `$0`.

The indexer was faithful to on-chain governance (those chains genuinely
whitelisted nothing / not WETH), but the consumer outcome was unusable.

The incoherence to resolve: each chain's `src/constants/price_connectors.json`
**already** defines the canonical base assets (WETH, USDC/USDT, the chain's gov
token, …) that the oracle uses to **derive** every other token's price — yet
those same anchors were `UNTRUSTED` and contributed `$0`. A token the indexer
trusts enough to *price the rest of the chain from* is, by the same token,
trustworthy enough to *value*.

## Decision (Option A)

Treat a chain's configured price connectors as a positive trust signal,
**alongside** the protocol whitelist. Implemented in `src/PriceTrust.ts`:

- New `isConnectorToken(chainId, address)` — O(1) membership against
  `CHAIN_CONSTANTS[chainId].oracle.priceConnectors`, via an eagerly-built
  per-chain `Set` (mirrors the `PRICE_REBIND` eager-Map idiom).
- The gate (`getGateDecisionFromSignals`, and `isTrusted`, which now delegates
  to it so the live gate and the persisted fields cannot diverge) trusts a token
  with **any** positive signal — whitelist **or** connector — unless the
  operator `BLACKLIST` overrides it.
- Reason precedence: no positive signal ⇒ `NON_WL` (blacklist membership is
  irrelevant — nothing to override); positive signal but blacklisted ⇒
  `BLACKLISTED`; otherwise `TRUSTED`, tagged `WL` (whitelisted, the stronger
  provenance) or `CONNECTOR` (trusted solely by connector membership).

This is symmetric with the existing `BLACKLIST` override, which already
overrides the protocol signal **downward**; connector membership overrides it
**upward**. It reuses an operator-curated surface (the connector config) rather
than introducing a new one.

### Alternatives rejected

- **Option B — a separate operator whitelist-override list** for base assets:
  redundant with the connector config and adds a second list to keep in sync.
- **Option C — accept `$0`, document the chains as USD-unavailable:** faithful
  to on-chain reality but ships unusable data on whole chains.

## Consequences

- **Mode (34443) and Swell (1923)** USD fields populate from their
  connector-anchored pools (WETH/USDC, …).
- **WETH on Soneium (1868) and Metal (1750)** is trusted; WETH-paired pools
  count both legs.
- **Optimism is a no-op** — all 16 connectors were already whitelisted. **Base**
  gains its one not-yet-whitelisted connector, USDe (`0x5d3a…`): a ~`$400` total
  correction across 5 small pools (a legitimate `$1` stable previously zeroed),
  **not** a regression. All other leaf chains were already fully whitelisted on
  their connectors (no change).
- **Blacklist still wins.** No configured connector is currently blacklisted
  (asserted by a test in `test/PriceTrust.test.ts`); if one is ever added it
  resolves `UNTRUSTED`/`BLACKLISTED`. Metal WETH's thin local price (~30% high)
  is handled by the #892/#897 directional cap + rebind, independent of this
  trust decision.
- **New `priceTrustReason` value `CONNECTOR`.** The field is a free-form
  `String` in `schema.graphql`, so no schema/codegen change is required.
- Pinned by `test/PriceTrust.test.ts`, data-driven over `price_connectors.json`
  so config and trust policy cannot silently drift apart.
