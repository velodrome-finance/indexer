# ADR 0006: Aero gauges, emissions and governance

- **Status:** Accepted (2026-11-13). Phases 2 (gauges, staking, emissions) and
  3 (governance and rewards) of the Aero integration; phase 1 is ADR 0005.

## Context

Aero (MetaDEX) replaced the legacy weekly veNFT voting with a different
system. These are the parts this indexer models. They were checked against
the public contracts (`metadex-public`, `metadex-slipstream-public`) and
against logs on every chain.

- **sAERO.** AERO is staked in a `VotingEscrow` on Base. Each NFT position has
  an amount, an unlock time and a permanent flag. Voting power is `amount` for
  a permanent stake. Otherwise it is `amount / MAXTIME * (end - t)`, with
  MAXTIME = 4 × 365 days. A `VoterPaymentsModule` moves stake between
  positions through `Rebalance`, which can mint a new position or pay the
  protocol accumulator (tokenId 0). There are no merges, splits or managed
  NFTs.
- **Allocation is a two-level ledger.** The root `Voter` on Base books each
  position's power per chain. New stake parks on `CHAIN0`; `ChainsAllocated`
  moves power from `CHAIN0` to chains. It also dispatches each chain's gauge
  split as a message.
- **Leaf books.** Each chain's `LeafVoter` (same address everywhere, Base
  included) books the budget it received (`ChainAllocated`) and the gauge split
  it applied (`GaugesAllocated`). It books an entry only on a registered,
  activated gauge with a non-zero emission cap. Everything else parks on the
  zero gauge and earns nothing. The `DEALLOC_GAUGE` sentinel returns power to
  root. Root credits that power back to `CHAIN0` only when the leaf confirms
  (`DeallocationProcessed`). Gauge allocations have a cooldown of 169,200 s
  (47 h) per position and chain.
- **Lazy emissions.** The Minter exposes a rate. Root and leaves accrue
  "ceilings": `GaugeCapSettled` credits a gauge, capped per second, and the
  excess goes to the chain surplus. Nothing is minted until an LP claims.
  The gauge then calls `LeafVoter.mintEmissions`, which mints the chain's
  `ReceiptToken` (xAERO, 18 decimals).
  - On a leaf chain the LP holds xAERO. Burning it (`Redeemed`) sends a
    message that makes root mint AERO on Base (`RedeemProcessed`, `Minted`).
  - On Base the receipt goes to the `RootEmissionsHandler`, which redeems it
    in the same transaction, so LPs receive AERO.
- **Forfeits.** A gauge returns, through `EmissionsForfeited`, accruals it
  cannot pay: periods with no staked liquidity in range, and early-withdraw
  penalties.
- **Fees and incentives.** Each gauge has one `VotingRewardsManager`. It pulls
  the staked liquidity's pool fees from the gauge (`FeesCollected`) and runs
  incentive programs (`IncentiveCreated`). sAERO allocators claim both
  (`ClaimFees`, `ClaimIncentives`).
- **Volume.** On Base this is the largest stream the indexer reads, in
  events per day on 2026-11-13:

  | Stream | Events/day |
  | --- | --- |
  | CL gauge deposits | 266k |
  | CL gauge withdrawals | 266k |
  | `GaugeCapSettled` | 446k |
  | `GaugeSettled` | 419k |
  | Claims | 172k |
  | Base-internal `Redeemed` / `RedeemProcessed` / `Minted` | 172k each |

  A Base claim alone emits about six events.

## Decision

### Separate entities where the semantics differ; reuse where they match

Reused (same meaning as legacy):

- `Pool.gaugeAddress`. Set when the gauge is created. It turns the NFPM's
  transfer to and from the gauge into stake and unstake, keeping the real
  owner.
- `Pool.gaugeIsAlive`. On an AERO pool it means activated and cap > 0. A cap
  of 0 is Aero's only deactivation; there is no kill.
- The staking fields on `Pool`, `UserStatsPerPool` and `NonFungiblePosition`.
  Aero Deposit, Withdraw and EmergencyWithdraw go through the legacy gauge
  arithmetic, so staked liquidity, the staked tick map and staked reserves
  behave as on legacy pools.
- `Pool.unstakedFee`. Aero's CustomUnstakedFeeModule has the same event and
  semantics.

New, because the meaning differs:

- `AeroGauge` holds the gauge, its rewards manager, cap, minimum stake,
  referral and weight. It mirrors the LeafVoter's per-gauge ledger
  (`totalEmissionsCredited` = ceiling, `totalEmissionsMinted` = claimed,
  `totalEmissionsForfeited` = surplus).
- The legacy `totalEmissions*` / `totalGaugeRewardsClaimed*` /
  `gaugeEmissionsCap` / `minStakeTime` fields stay at their defaults on AERO
  pools. Legacy emissions are distributed per epoch in one token per chain.
  Aero emissions are minted on claim, the cap is per second and the minimum
  stake is counted in blocks. Putting them in the same columns would mix
  units, and on Ink and Base it would mix tokens.
- sAERO gets its own `SAeroPosition` instead of `VeNFTState`. It has no lock
  merging or splitting and no managed NFTs. Rebalance and the accumulator have
  no veNFT equivalent.
- Allocations get `AeroRootAllocation`, `AeroRootGaugeVote`,
  `AeroLeafTokenState` and `AeroLeafAllocation` instead of `VeNFTPoolVote`.
  Allocations are continuous and two-level, not weekly votes per pool.

### Units

- **Emission amounts** are in the chain's reward token
  (`AeroGauge.rewardToken`): AERO on Base, xAERO elsewhere. Both have 18
  decimals and xAERO redeems 1:1, so cross-chain sums are AERO-equivalent.
  They must not be summed with the legacy VELO / AERO v1 fields.
- **USD** is the reward token's stored `pricePerUSDNew` on the event's chain,
  through the price-trust gate. No refresh is triggered and no other chain is
  read. Where xAERO has no indexed price, USD is 0. In that case value it in
  queries at Base AERO's `TokenPriceSnapshot`.
- **Caps** are reward-token wei per second.
- **Penalty rates and referral shares** are in pips (1e6 = 100%).
- **Allocations** are undecayed AERO amounts, as the contracts book them.
  `AeroGauge.lastGaugeWeight` is the decayed voting power at the last
  settlement.

### No cross-chain writes

Every Aero handler reads and writes only rows of the event's chain:

- Root and leaf allocations are separate books, joined in queries.
- `AeroRootGaugeVote` is what root dispatched, not what the leaf applied.
- xAERO redemptions are recorded on both sides: INITIATED on the leaf,
  PROCESSED on Base.
- Migration is recorded per chain: an Optimism `VeNFTMigrated` and its Base
  `Migrated` settlement are separate rows.

The leaf booking rule is replayed from same-chain state:

- the gauge's registration, activation and cap;
- the position's zero-cap flag;
- the position's previous split.

The leaf's events carry no stake shape. So two kinds of entry are booked here
although the LeafVoter parks them: an entry from a position whose stake had
already expired, and one under 1.26e-10 AERO (dust).

### Analytics first: rows for actions, totals for plumbing

Append-only, ClickHouse-only rows:

- `AeroGaugeStakeEvent`: deposits and withdrawals.
- `AeroEmissionsEvent`: claims, deferrals, referral legs and penalties.
- `AeroAllocationEvent`: every root ledger move, root dispatch, leaf budget
  change and per-gauge leaf booking.
- `SAeroPositionEvent`: every position change.
- `AeroVotingRewardsEvent`: fee collections, fee and incentive claims,
  programs and sweeps.
- `AeroRedemptionEvent`.
- `AeroMinterEvent`.
- `AeroMigrationEvent`.

High-frequency plumbing gets totals and hourly snapshots only, with no row
per event:

- `GaugeCapSettled`, `EmissionsMinted` and `EmissionsForfeited` →
  `AeroGauge`, `AeroLeafVoterState` and their hourly snapshots.
- `Minted` → `AeroMinterState` and `AeroMinterSnapshot`.
- Base's automatic `Redeemed` / `RedeemProcessed` → `AeroLeafVoterState` and
  `AeroRootChainState` (cross-chain ones also get rows).

Not indexed:

- `GaugeSettled` (duplicates `GaugeCapSettled`).
- `NotifyFeesAmount` and the rewards managers' `Checkpoint` / `Reset`.
- The LeafVoter's claim-forwarding events.
- Message orchestrator traffic.
- Tape contracts.

### Performance

- Every read is a primary-key read. Gauges are found by `{chainId}-{gauge}`,
  rewards managers by address, and incentive programs by
  `(manager, programId)`.
- Array events read their rows in parallel: allocations at most
  `maxGauges` (20) per side, root moves at most the registered chains, and
  `Rebalance` legs.
- `Rebalance` mint legs carry a sentinel tokenId. The minted ids are resolved
  from the escrow's last minted id, because the escrow mints them in leg order
  just before the event. No scan is needed.
- No RPC is used. Gauge factories do not emit their default cap, so
  `AeroGauge.emissionCap` is null (the factory default, never 0) until the
  first `EmissionCapSet` or `GaugeCapSettled`.

## Consequences

- Needs a resync of the Aero chains (new contracts, new Pool links on Aero
  pools).
- AERO pools now carry `gaugeAddress` / `gaugeIsAlive` and staked liquidity.
  Their legacy emission fields stay 0; use `AeroGauge`.
- Two known approximations, both documented on the entities:
  - Leaf bookings of expired or dust entries.
  - The budget after an emergency deallocation, which is not in the event
    and is corrected by the next `ChainAllocated`.
- Delegation is not indexed: `DelegateChanged` names the owner, not the
  tokenId.
