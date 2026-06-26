<!--
  AUTO-GENERATED — do not edit by hand.
  Source: schema.graphql
  Regenerate: pnpm tsx scripts/generate-schema-docs.ts
-->

# Entity & field reference

Generated from [`schema.graphql`](../schema.graphql). The schema defines **39 entity types**; each becomes a queryable table in the indexer's database.

## Reading this reference

- **`Type`** is the GraphQL type. A trailing `!` means non-nullable.
- **`BigInt`** fields are fixed-point integers (no JS number precision loss); divide by the relevant token's `decimals` (or `10^18` for USD/`WAD`-scaled values) to get a human number.
- **`Timestamp`** is an ISO-8601 / epoch timestamp; **`Bytes`**/**`String`** hold addresses and hashes.
- **_(indexed)_** marks fields with a secondary index (`@index`) — efficient to filter on. **_(derived)_** marks reverse-relation fields (`@derivedFrom`) that are computed, not stored.
- Entity `id` formats and other conventions are documented inline in each `id` row. See the [Data model](../README.md#data-model) section of the README for the high-level map.

## Contents

- **Core aggregates** — [Pool](#pool), [Token](#token), [UserStatsPerPool](#userstatsperpool), [NonFungiblePosition](#nonfungibleposition), [VeNFTState](#venftstate), [VeNFTPoolVote](#venftpoolvote), [ALM_LP_Wrapper](#alm_lp_wrapper)
- **Snapshots** — [PoolSnapshot](#poolsnapshot), [TokenPriceSnapshot](#tokenpricesnapshot), [UserStatsPerPoolSnapshot](#userstatsperpoolsnapshot), [NonFungiblePositionSnapshot](#nonfungiblepositionsnapshot), [VeNFTStateSnapshot](#venftstatesnapshot), [VeNFTPoolVoteSnapshot](#venftpoolvotesnapshot), [ALM_LP_WrapperSnapshot](#alm_lp_wrappersnapshot)
- **Config & registry** — [FactoryRegistryConfig](#factoryregistryconfig), [DynamicFeeGlobalConfig](#dynamicfeeglobalconfig), [CLGaugeConfig](#clgaugeconfig), [FeeToTickSpacingMapping](#feetotickspacingmapping), [RedistributorConfig](#redistributorconfig), [RootPool_LeafPool](#rootpool_leafpool), [RootGauge_RootPool](#rootgauge_rootpool)
- **Pool launcher** — [PoolLauncherPool](#poollauncherpool), [PoolLauncherConfig](#poollauncherconfig)
- **Cross-chain superswaps (Hyperlane)** — [SuperSwap](#superswap), [OUSDTBridgedTransaction](#ousdtbridgedtransaction), [OUSDTSwaps](#ousdtswaps), [DispatchId_event](#dispatchid_event), [ProcessId_event](#processid_event)
- **Internal buffers & deferred state** — [PendingVote](#pendingvote), [CLPoolPendingInitialize](#clpoolpendinginitialize), [PendingRootPoolMapping](#pendingrootpoolmapping), [PendingDistribution](#pendingdistribution), [CLPoolMintEvent](#clpoolmintevent), [CLPositionPendingPrincipal](#clpositionpendingprincipal), [TxCLPoolMintRegistry](#txclpoolmintregistry), [TxPoolTransferRegistry](#txpooltransferregistry), [PoolTransferInTx](#pooltransferintx), [ALMLPWrapperTransferInTx](#almlpwrappertransferintx), [ALM_TotalSupplyLimitUpdated_event](#alm_totalsupplylimitupdated_event)

## Core aggregates

Latest-state entities that hold the headline metrics most consumers query.

### Pool

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{poolAddress} (PoolId) |
| `chainId` | `Int!` | chain id |
| `poolAddress` | `String!` | address of the pool |
| `name` | `String!` | name of the pool |
| `token0_id` | `String!` | token0 id |
| `token1_id` | `String!` | token1 id |
| `token0_address` | `String!` | token0 address |
| `token1_address` | `String!` | token1 address |
| `isStable` | `Boolean!` | whether the pool is a stable AMM or a volatile AMM |
| `isCL` | `Boolean!` | whether the pool is a CL pool |
| `createdBlockNumber` | `BigInt!` | Block number at which PoolCreated fired; used to clamp roundBlockToInterval so getSwapFee/getTokenPrice never query before pool deployment (#759) |
| `tickSpacing` | `BigInt!` | Tick spacing of the pool; 0 for non-CL pools |
| `reserve0` | `BigInt!` | reserve of token0 in token units |
| `reserve1` | `BigInt!` | reserve of token1 in token units |
| `totalLPTokenSupply` | `BigInt!` | total supply of LP tokens (tracked from Transfer events) |
| `totalLiquidityUSD` | `BigInt!` | total liquidity of the swap pool in USD |
| `totalVolume0` | `BigInt!` | total swap volume of token0 in token units |
| `totalVolume1` | `BigInt!` | total swap volume of token1 in token units |
| `totalVolumeUSD` | `BigInt!` | total swap volume of the pool in USD |
| `totalFeesGenerated0` | `BigInt!` | total swap fees generated of token0, 1e18-normalized token units (same scale on V2 & CL — issue #812) |
| `totalFeesGenerated1` | `BigInt!` | total swap fees generated of token1, 1e18-normalized token units (same scale on V2 & CL — issue #812) |
| `totalFeesGeneratedUSD` | `BigInt!` | total swap fees of the pool in USD |
| `totalUnstakedFeesCollected0` | `BigInt!` | total fees collected from unstaked LPs (Collect events) in token0 units |
| `totalUnstakedFeesCollected1` | `BigInt!` | total fees collected from unstaked LPs (Collect events) in token1 units |
| `totalStakedFeesCollected0` | `BigInt!` | total fees collected from staked LPs (CollectFees events) in token0 units |
| `totalStakedFeesCollected1` | `BigInt!` | total fees collected from staked LPs (CollectFees events) in token1 units |
| `totalUnstakedFeesCollectedUSD` | `BigInt!` | total fees collected from unstaked LPs (Collect events) in USD |
| `totalStakedFeesCollectedUSD` | `BigInt!` | total fees collected from staked LPs (CollectFees events) in USD |
| `numberOfSwaps` | `BigInt!` | total number of swaps in the pool |
| `token0Price` | `BigInt!` | price of token0 relative to token1 |
| `token1Price` | `BigInt!` | price of token1 relative to token0 |
| `totalVotesDeposited` | `BigInt!` | total votes deposited in veToken units |
| `totalVotesDepositedUSD` | `BigInt!` | total votes deposited in USD |
| `totalEmissions` | `BigInt!` | total emissions for the pool in reward token units (VELO form Optimism and AERO for Base); 18-dec, single reward token per chain — coherent within a chain, NOT cross-chain summable (see #813) |
| `totalEmissionsUSD` | `BigInt!` | total emissions for the pool in USD |
| `totalEmissionsRedistributed` | `BigInt!` | cumulative reward tokens this pool's gauge received from the Redistributor (Redistributed events); AERO/VELO 18-dec, single reward token per chain — coherent within a chain, NOT cross-chain summable (see #813) |
| `totalEmissionsForfeited` | `BigInt!` | cumulative reward tokens this pool's gauge forwarded to the Redistributor or minter because it was over its cap (Deposited events); AERO/VELO 18-dec, single reward token per chain — coherent within a chain, NOT cross-chain summable (see #813) |
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last update |
| `lastSnapshotTimestamp` | `Timestamp!` | timestamp of last snapshot |
| `feeProtocol0` | `BigInt` | protocol fee % for token0. Set via SetFeeProtocol (governance-gated admin call). Uniformly 0 across all Slipstream pools as of 2026-05: Aerodrome/Velodrome governance has not activated protocol fees. The handler (src/EventHandlers/CLPool.ts) is wired correctly; the field will populate only when (and if) governance turns the toggle on. Slipstream's slot0() does not pack feeProtocol and the pool exposes no feeProtocol() getter, so the on-chain SetFeeProtocol event is the only source. |
| `feeProtocol1` | `BigInt` | As feeProtocol0, for token1. |
| `observationCardinalityNext` | `BigInt` | oracle observation cardinality |
| `sqrtPriceX96` | `BigInt` | current sqrt price (Q96 fixed point) - updated from Swap/Initialize events |
| `tick` | `BigInt` | current tick - updated from Swap/Initialize events |
| `liquidityInRange` | `BigInt` | active-tick in-range liquidity L. Recomputed on Swap; bumped on Mint/Burn when tickLower <= currentTick < tickUpper. |
| `stakedLiquidityInRange` | `BigInt` | staked in-range liquidity L (running counter from tick-based tracking) |
| `stakedReserve0` | `BigInt` | staked reserves in token0 raw units (running counter) |
| `stakedReserve1` | `BigInt` | staked reserves in token1 raw units (running counter) |
| `hasStakes` | `Boolean!` | True once any staked position has been recorded for this pool. Gates the per-swap staked-tick sweep in processTickCrossings: pools that have never been staked skip the sweep entirely. Set on the first gauge Deposit. One-way latch: does NOT clear if every staked position is later withdrawn. A transiently-staked-then-fully-unstaked pool will keep running the sweep (with zero contributions). The structural fix that makes the residual cost negligible is tracked in #649 (sparse stakedTickEdges list); until it lands, the latch is "accept a degenerate case to avoid the bookkeeping of clearing". |
| `stakedTickEdges` | `[BigInt!]!` | Parallel arrays encoding Uniswap v3's per-tick liquidityNet for the staked subset. Sorted ascending by tick, dedup'd, no zero-net entries. Same length, same index: (stakedTickEdges[i], stakedTickEdgeNets[i]) is one (tick, net) pair. Two arrays instead of one list-of-structs because GraphQL lists only allow scalars or named types — tuples don't exist at this layer. Maintained on gauge deposit / withdraw / NFPM staked-position liquidity changes. Consumed by processTickCrossings via in-memory binary search — no per-tick entity loads on the swap path, which breaks the OOM chain-of-amplification from #648. |
| `stakedTickEdgeNets` | `[BigInt!]!` | Per-tick liquidityNet for the staked subset; paired index-for-index with stakedTickEdges (see stakedTickEdges). |
| `tickEdges` | `[BigInt!]!` | Total-liquidity analog of stakedTickEdges/stakedTickEdgeNets: the pool's full per-tick liquidityNet map (all positions, not just staked). Maintained on CLPool Mint/Burn; consumed by processTickCrossings on the swap path to compute the fee-free reserve delta from pool geometry (L·ΔsqrtPrice), replacing the stale-fee approximation that drifts on dynamic-fee pools (#803). |
| `tickEdgeNets` | `[BigInt!]!` | Per-tick liquidityNet for all positions; paired index-for-index with tickEdges (see tickEdges). |
| `totalFlashLoanFees0` | `BigInt` | total flash loan fees collected in token0 |
| `totalFlashLoanFees1` | `BigInt` | total flash loan fees collected in token1 |
| `totalFlashLoanFeesUSD` | `BigInt` | total flash loan fees collected in USD |
| `totalFlashLoanVolumeUSD` | `BigInt` | total flash loan volume in USD |
| `numberOfFlashLoans` | `BigInt` | total number of flash loans |
| `gaugeIsAlive` | `Boolean!` | whether the gauge is alive |
| `gaugeAddress` | `String` | address of the gauge for this pool _(indexed)_ |
| `gaugeEmissionsCap` | `BigInt` | Emissions cap for gauge. If not specified in an SetEmissionsCap event, set to defaultEmissionsCap as per CLGaugeConfig. If CLGaugeConfig doesn't exist, there's no emissions cap |
| `minStakeTime` | `BigInt!` | Per-pool LP stake lockup (seconds). Seeded from CLGaugeConfig.defaultMinStakeTime at pool creation; overridden by CLGaugeFactoryV3.SetPoolMinStakeTime. 0 before V3. |
| `numberOfGaugeDeposits` | `BigInt!` | number of gauge deposits (staking) |
| `numberOfGaugeWithdrawals` | `BigInt!` | number of gauge withdrawals (unstaking) |
| `numberOfGaugeRewardClaims` | `BigInt!` | number of gauge reward claims |
| `totalGaugeRewardsClaimedUSD` | `BigInt!` | total gauge rewards claimed in USD |
| `totalGaugeRewardsClaimed` | `BigInt!` | total gauge rewards claimed in reward-token units — AERO on Base, VELO on Optimism (18-dec); single reward token per chain, coherent within a chain, NOT summable across chains (see #813) |
| `currentLiquidityStaked` | `BigInt!` | current liquidity staked in gauge in token units |
| `currentLiquidityStakedUSD` | `BigInt!` | current liquidity staked in gauge in USD (pool-level — the live staked-USD figure, maintained on gauge events; the per-user `UserStatsPerPool.currentLiquidityStakedUSD` is as-of-last-activity, see #902) |
| `bribeVotingRewardAddress` | `String` | address of the bribe voting reward contract for this pool _(indexed)_ |
| `totalBribeClaimedUSD` | `BigInt!` | total bribes claimed by users in USD (canonical cross-token aggregate; raw token-unit sum dropped in #813 — bribes are arbitrary heterogeneous tokens) |
| `feeVotingRewardAddress` | `String` | address of the fee voting reward contract for this pool _(indexed)_ |
| `totalFeeRewardClaimedUSD` | `BigInt!` | total fee rewards claimed by users in USD (canonical cross-token aggregate; raw token-unit sum dropped in #813 — fee rewards mix the pool's two fee tokens) |
| `veNFTamountStaked` | `BigInt!` | total amount of veNFT staked for this pool |
| `baseFee` | `BigInt!` | Current base fee, FEE_SCALE 1e6 (hundredths of a basis point); single fee divisor across V2 & CL — issue #812 |
| `feeCap` | `BigInt` | Current fee cap for pool |
| `scalingFactor` | `BigInt` | Current scaling factor for pool |
| `currentFee` | `BigInt!` | Current fee (base + dynamic), FEE_SCALE 1e6; single fee divisor across V2 & CL — issue #812 |
| `unstakedFee` | `BigInt` | Raw customFee value last emitted by an UnstakedFeeModule for this pool (CL pools only). 0 = no override (factory default applies), 420 = explicit 0% fee (ZERO_FEE_INDICATOR), else fee rate with 6-decimal precision (e.g. 500_000 = 50%). Null = never set. |
| `poolLauncherPoolId` | `String` | ID of the PoolLauncherPool entity if this pool was launched via Pool Launcher |
| `factoryAddress` | `String` | Address of the factory that created this pool (e.g. CLFactory for CL pools, set from PoolCreated event) |
| `nfpmAddress` | `String` | Address of the NFPM contract that mints positions for this CL pool. Null for V2 (non-CL) pools. Resolved from (chainId, factoryAddress) via nfpmForCLPool in Constants.ts. Used by downstream consumers (gauges, user-stats, NFPM handlers) to derive the correct NFPM without a separate scan. _(indexed)_ |
| `rootPoolMatchingHash` | `String!` | {chainId}_{token0_address}_{token1_address}_{tickSpacing} _(indexed)_ |

### Token

Entity that tracks the latest state of the token entity By nature this entity saves the latest state of the token, and its state at different times should be attained from the snapshot entities

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{address} (TokenId) |
| `address` | `String!` | token address _(indexed)_ |
| `symbol` | `String!` | token symbol |
| `name` | `String!` | token name |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `decimals` | `BigInt!` | number of decimals |
| `pricePerUSDNew` | `BigInt!` | price of token per USD |
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last refresh attempt (used by 1-hour throttle) |
| `lastSuccessfulPriceTimestamp` | `Timestamp` | timestamp of last non-zero oracle write (used by 7-day fallback staleness window, #694) |
| `isWhitelisted` | `Boolean!` | whether the token is whitelisted |
| `priceTrustOutcome` | `String` | Price-trust gate per-token decision surface (issue #755 slice 2). Populated at every Token construction site (Voter.WhitelistToken, SuperchainLeafVoter .WhitelistToken, PriceOracle.createTokenEntity, VotingReward reward-token bootstrap) via `PriceTrust.getGateDecisionFromSignals`; subsequent refreshes preserve the stamped values via spread until slice-3+ aggregator paths re-evaluate via `PriceTrust.getGateDecision` at consume time. Null only on rows that predate the field's introduction. Stored as String (not enum) so values can extend without an Envio schema migration. The TypeScript value sets are pinned by the `PRICE_TRUST_OUTCOME` / `PRICE_TRUST_REASON` const objects in `src/PriceTrust.ts` — call sites should reference those constants rather than bare string literals. Trusted-USD aggregates are written into the existing `*USD` fields on Pool — no `*USDTrusted` companion fields. Per-chain rollback uses the migration mode flag introduced in slice 4; A/B comparison against pre-gate values is done offline via the diff script (issue #755 US #19). |
| `priceTrustReason` | `String` | Reason code paired with priceTrustOutcome; values pinned by PRICE_TRUST_REASON in src/PriceTrust.ts (see priceTrustOutcome). |

### UserStatsPerPool

Entity for tracking user activity and positions in specific pools

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{userAddress}-{poolAddress} (UserStatsPerPoolId) |
| `userAddress` | `String!` | user wallet address _(indexed)_ |
| `poolAddress` | `String!` | address of the pool these stats are scoped to _(indexed)_ |
| `chainId` | `Int!` | chain id |
| `lpBalance` | `BigInt!` | user's LP token balance (tracked from Transfer events) |
| `totalLiquidityAddedUSD` | `BigInt!` | cumulative USD value of liquidity added (from IncreaseLiquidity events, Transfer ADD attribution, and direct non-NFPM CLPool.Mint) |
| `totalLiquidityAddedToken0` | `BigInt!` | cumulative raw token0 amount added (sum of event.params.amount0 from IncreaseLiquidity + Transfer ADD + direct non-NFPM CLPool.Mint). May differ from removed due to price movement between deposit and withdrawal |
| `totalLiquidityAddedToken1` | `BigInt!` | cumulative raw token1 amount added (sum of event.params.amount1 from IncreaseLiquidity + Transfer ADD + direct non-NFPM CLPool.Mint). May differ from removed due to price movement between deposit and withdrawal |
| `totalLiquidityRemovedUSD` | `BigInt!` | cumulative USD value of liquidity removed (from DecreaseLiquidity events, Transfer REMOVE attribution, and direct non-NFPM CLPool.Burn) |
| `totalLiquidityRemovedToken0` | `BigInt!` | cumulative raw token0 amount removed (sum of event.params.amount0 from DecreaseLiquidity + Transfer REMOVE + direct non-NFPM CLPool.Burn). Can exceed totalLiquidityAddedToken0 due to price movement (impermanent loss rebalancing) |
| `totalLiquidityRemovedToken1` | `BigInt!` | cumulative raw token1 amount removed (sum of event.params.amount1 from DecreaseLiquidity + Transfer REMOVE + direct non-NFPM CLPool.Burn). Can exceed totalLiquidityAddedToken1 due to price movement (impermanent loss rebalancing) |
| `numberOfSwaps` | `BigInt!` | number of swaps in this pool |
| `totalSwapVolumeAmount0` | `BigInt!` | swap volume denominated in token0 in this pool |
| `totalSwapVolumeAmount1` | `BigInt!` | swap volume denominated in token1 in this pool |
| `totalSwapVolumeUSD` | `BigInt!` | swap volume in USD in this pool |
| `totalFeesContributedUSD` | `BigInt!` | total fees contributed in USD (from swaps made by the user - essentially fees paid by the user in swaps) |
| `totalFeesContributed0` | `BigInt!` | total fees contributed in token0, 1e18-normalized (fees paid by the user in swaps; same scale on V2 & CL — issue #812) |
| `totalFeesContributed1` | `BigInt!` | total fees contributed in token1, 1e18-normalized (fees paid by the user in swaps; same scale on V2 & CL — issue #812) |
| `numberOfFlashLoans` | `BigInt!` | number of flash loan swaps in this pool |
| `totalFlashLoanVolumeUSD` | `BigInt!` | flash loan swap volume in USD in this pool |
| `numberOfGaugeDeposits` | `BigInt!` | number of gauge deposits (staking) |
| `numberOfGaugeWithdrawals` | `BigInt!` | number of gauge withdrawals (unstaking) |
| `numberOfGaugeRewardClaims` | `BigInt!` | number of gauge reward claims |
| `totalGaugeRewardsClaimedUSD` | `BigInt!` | total gauge rewards claimed in USD |
| `totalGaugeRewardsClaimed` | `BigInt!` | total gauge rewards claimed in reward-token units — AERO on Base, VELO on Optimism (18-dec); single reward token per chain, coherent within a chain, NOT summable across chains (see #813) |
| `totalStakedFeesCollected0` | `BigInt!` | pool fees (token0) collected by this user from staked position (CollectFees) |
| `totalStakedFeesCollected1` | `BigInt!` | pool fees (token1) collected by this user from staked position (CollectFees) |
| `totalStakedFeesCollectedUSD` | `BigInt!` | pool fees in USD collected by this user from staked position (CollectFees) - position earned vs totalGaugeRewardsClaimed (emissions received) |
| `totalUnstakedFeesCollected0` | `BigInt!` | pool fees (token0) collected by this user from unstaked position (Collect) |
| `totalUnstakedFeesCollected1` | `BigInt!` | pool fees (token1) collected by this user from unstaked position (Collect) |
| `totalUnstakedFeesCollectedUSD` | `BigInt!` | pool fees in USD collected by this user from unstaked position (Collect) |
| `currentLiquidityStaked` | `BigInt!` | current liquidity staked in gauge in token units |
| `currentLiquidityStakedUSD` | `BigInt!` | current liquidity staked in gauge in USD — **as-of-last-activity, not current** (issue #902). The USD valuation is recomputed only at hourly snapshot time, and that recompute fires only when one of this user's own events crosses an epoch (Envio has no background cron; `UserStatsPerPool.ts` gates it on `shouldSnapshot`). An idle staker is never revalued, so the figure stays frozen at their last action — often `0` while a real, valuable position is still staked. Summed across users it under-counts pool staked-USD by ~12–31%. For a current per-user figure, read staked units (`currentLiquidityStaked`) and value them yourself, or use pool-level `Pool.currentLiquidityStakedUSD` (the live figure). Treat `0` as possibly stale, not "no stake". Computing this at gauge deposit/withdraw time (those handlers already load pool, tokens, and position) is a possible follow-up (#902). |
| `stakedCLPositionTokenIds` | `[BigInt!]!` | tokenIds of CL positions currently staked in gauge (maintained on deposit/withdraw, enables O(1) primary-key lookups per position at snapshot time) |
| `totalBribeClaimedUSD` | `BigInt!` | total USD value of bribe rewards claimed by this user for this pool (canonical cross-token aggregate; raw token-unit sum dropped in #813 — bribes are arbitrary heterogeneous tokens) |
| `totalFeeRewardClaimedUSD` | `BigInt!` | total USD value of fee rewards claimed by this user for this pool (canonical cross-token aggregate; raw token-unit sum dropped in #813 — fee rewards mix the pool's two fee tokens) |
| `veNFTamountStaked` | `BigInt!` | amount of veNFT staked by this user for this pool |
| `almAddress` | `String!` | Address of ALM LP Wrapper (if the user interacts with it; otherwise defaults to "") |
| `almLpAmount` | `BigInt!` | Number of LP tokens |
| `lastAlmActivityTimestamp` | `Timestamp!` | last ALM related activity that changed ALM related fields on user entity |
| `firstActivityTimestamp` | `Timestamp!` | first activity in this pool |
| `lastActivityTimestamp` | `Timestamp!` | last activity in this pool |
| `lastSnapshotTimestamp` | `Timestamp` | nullable - null means never snapshotted |

### NonFungiblePosition

Tracks relevant data for each NFT minted: each NFT represents a concentrated position in a pool Note: amount0, amount1, amountUSD are derived fields computed on-demand from liquidity + sqrtPriceX96 + ticks

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{nfpmAddress}-{tokenId} (NonFungiblePositionId). Natural key is (NFPM, tokenId); pool is metadata and preserved as a field. nfpmAddress disambiguates intra-chain tokenId collisions across multiple NFPMs (e.g. Optimism has two). |
| `chainId` | `Int!` | Chain ID where the NFT exists |
| `tokenId` | `BigInt!` | Token ID of the NFT (from Transfer event) _(indexed)_ |
| `nfpmAddress` | `String!` | Address of the NFPM contract that emitted the Transfer; disambiguates intra-chain tokenId collisions across multiple NFPMs (e.g. Optimism has two) _(indexed)_ |
| `owner` | `String!` | Checksum address of the current owner (from Transfer event) _(indexed)_ |
| `pool` | `String!` | Address of the CL pool this position belongs to _(indexed)_ |
| `tickUpper` | `BigInt!` | Upper tick of the position range |
| `tickLower` | `BigInt!` | Lower tick of the position range |
| `token0` | `String!` | Address of token0 in the position |
| `token1` | `String!` | Address of token1 in the position |
| `liquidity` | `BigInt!` | Current liquidity value of the position |
| `mintTransactionHash` | `String!` | Transaction hash of the NFT mint transaction _(indexed)_ |
| `mintLogIndex` | `Int!` | Log index of CLPool.Mint event (for placeholder matching) |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp of last update |
| `lastSnapshotTimestamp` | `Timestamp` | nullable - null means never snapshotted |
| `isStakedInGauge` | `Boolean!` | Set from NFPM.Transfer to/from the pool's gauge; owner is not updated on gauge transfers so we need this to know staked vs not. |

### VeNFTState

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId} (VeNFTId) |
| `chainId` | `Int!` | chain id |
| `tokenId` | `BigInt!` | veNFT token ID |
| `owner` | `String!` | current owner address of the veNFT |
| `locktime` | `BigInt!` | lock expiry timestamp (seconds); 0 for permanent locks |
| `isPermanent` | `Boolean!` | whether the lock is permanent (never expires) |
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last update |
| `totalValueLocked` | `BigInt!` | amount of governance token locked in the veNFT |
| `isAlive` | `Boolean!` | whether the veNFT still exists (false after burn/withdraw) |
| `lastSnapshotTimestamp` | `Timestamp` | nullable - null means never snapshotted |
| `votesPerPool` | `[VeNFTPoolVote!]!` | reverse relation: this veNFT's per-pool vote allocations _(derived)_ |

### VeNFTPoolVote

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId}-{poolAddress} (VeNFTPoolVoteId) |
| `poolAddress` | `String!` | pool this veNFT allocated votes to _(indexed)_ |
| `veNFTamountStaked` | `BigInt!` | vote weight this veNFT allocated to the pool, in veToken units |
| `veNFTState` | `VeNFTState!` | the veNFT that cast this vote _(indexed)_ |
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last update |

### ALM_LP_Wrapper

ALM LP Wrapper entity Tracks both the LP wrapper state (aggregated deposits/withdrawals) and the strategy position state Relationship: 1 LP wrapper per pool, 1 strategy per LP wrapper, 1 tokenId per strategy, 1 AMM position per tokenId (1:1:1:1 relationship) Therefore this single entity tracks everything for the wrapper and its strategy

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{wrapperAddress} (ALMLPWrapperId) |
| `chainId` | `Int!` | The blockchain network ID where this wrapper exists |
| `pool` | `String!` | Address of the pool this ALM wrapper is associated with _(indexed)_ |
| `token0` | `String!` | Address of token 0 |
| `token1` | `String!` | Address of token 1 |
| `lpAmount` | `BigInt!` | Total number of LP tokens wrapped (aggregated across all users) |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp of the last update to this entity |
| `tokenId` | `BigInt!` | Equal to tokenId. Unique identifier for the strategy/position _(indexed)_ |
| `tickLower` | `BigInt!` | Lower tick bound of the position's price range (in tick units) |
| `tickUpper` | `BigInt!` | Upper tick bound of the position's price range (in tick units) |
| `property` | `BigInt!` | Pool property parameter from the AMM position struct |
| `liquidity` | `BigInt!` | Amount of liquidity currently in the AMM position |
| `strategyType` | `BigInt!` | Type/kind of ALM strategy being used (defines the strategy behavior) |
| `tickNeighborhood` | `BigInt!` | Tick neighborhood parameter for the strategy (defines rebalancing range around current price) |
| `tickSpacing` | `BigInt!` | Tick spacing for the strategy (minimum tick movement allowed) |
| `positionWidth` | `BigInt!` | Width parameter for the strategy (defines the position size in ticks) |
| `maxLiquidityRatioDeviationX96` | `BigInt!` | Maximum allowed liquidity ratio deviation in X96 fixed-point format (controls rebalancing thresholds) |
| `creationTimestamp` | `Timestamp!` | Timestamp when this strategy was created (from StrategyCreated event) |
| `strategyTransactionHash` | `String!` | Transaction hash of the StrategyCreated event _(indexed)_ |
| `lastSnapshotTimestamp` | `Timestamp` | nullable - null means never snapshotted |

## Snapshots

Hourly, epoch-aligned copies of the core aggregates for historical/time-series queries.

### PoolSnapshot

Snapshot of the LiquidityPool entity

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{poolAddress}-{epochMs} (PoolId-epochMs, epochMs from getSnapshotEpoch) |
| `chainId` | `Int!` | chain id |
| `name` | `String!` | name of the pool |
| `poolAddress` | `String!` | address of the pool |
| `token0_id` | `String!` | token0 id |
| `token1_id` | `String!` | token1 id |
| `token0_address` | `String!` | token0 address |
| `token1_address` | `String!` | token1 address |
| `isStable` | `Boolean!` | whether the pool is a stable AMM or a volatile AMM |
| `isCL` | `Boolean!` | whether the pool is a CL pool |
| `reserve0` | `BigInt!` | reserve of token0 in token units |
| `reserve1` | `BigInt!` | reserve of token1 in token units |
| `totalLPTokenSupply` | `BigInt!` | total supply of LP tokens (tracked from Transfer events) |
| `totalLiquidityUSD` | `BigInt!` | total liquidity of the swap pool in USD |
| `totalVolume0` | `BigInt!` | total swap volume of token0 in token units |
| `totalVolume1` | `BigInt!` | total swap volume of token1 in token units |
| `totalVolumeUSD` | `BigInt!` | total swap volume of the pool in USD |
| `totalFeesGenerated0` | `BigInt!` | total swap fees generated of token0, 1e18-normalized token units (same scale on V2 & CL — issue #812) |
| `totalFeesGenerated1` | `BigInt!` | total swap fees generated of token1, 1e18-normalized token units (same scale on V2 & CL — issue #812) |
| `totalFeesGeneratedUSD` | `BigInt!` | total swap fees of the pool in USD |
| `totalUnstakedFeesCollected0` | `BigInt!` | total fees collected from unstaked LPs (Collect events) in token0 units |
| `totalUnstakedFeesCollected1` | `BigInt!` | total fees collected from unstaked LPs (Collect events) in token1 units |
| `totalStakedFeesCollected0` | `BigInt!` | total fees collected from staked LPs (CollectFees events) in token0 units |
| `totalStakedFeesCollected1` | `BigInt!` | total fees collected from staked LPs (CollectFees events) in token1 units |
| `totalUnstakedFeesCollectedUSD` | `BigInt!` | total fees collected from unstaked LPs (Collect events) in USD |
| `totalStakedFeesCollectedUSD` | `BigInt!` | total fees collected from staked LPs (CollectFees events) in USD |
| `numberOfSwaps` | `BigInt!` | total number of swaps in the pool |
| `token0Price` | `BigInt!` | price of token0 relative to token1 |
| `token1Price` | `BigInt!` | price of token1 relative to token0 |
| `totalVotesDeposited` | `BigInt!` | total votes deposited in veToken units |
| `totalVotesDepositedUSD` | `BigInt!` | total votes deposited in USD |
| `totalEmissions` | `BigInt!` | total emissions for the pool in reward token units (VELO form Optimism and AERO for Base); 18-dec, single reward token per chain — coherent within a chain, NOT cross-chain summable (see #813) |
| `totalEmissionsUSD` | `BigInt!` | total emissions for the pool in USD |
| `totalEmissionsRedistributed` | `BigInt!` | cumulative reward tokens this pool's gauge received from the Redistributor at snapshot time; AERO/VELO 18-dec, single reward token per chain — coherent within a chain, NOT cross-chain summable (see #813) |
| `totalEmissionsForfeited` | `BigInt!` | cumulative reward tokens this pool's gauge forwarded to the Redistributor or minter at snapshot time; AERO/VELO 18-dec, single reward token per chain — coherent within a chain, NOT cross-chain summable (see #813) |
| `gaugeIsAlive` | `Boolean!` | whether the gauge is alive |
| `gaugeAddress` | `String` | address of the gauge for this pool _(indexed)_ |
| `gaugeEmissionsCap` | `BigInt` | Emissions cap for gauge |
| `minStakeTime` | `BigInt!` | Per-pool LP stake lockup (seconds) at snapshot time |
| `numberOfGaugeDeposits` | `BigInt!` | number of gauge deposits (staking) |
| `numberOfGaugeWithdrawals` | `BigInt!` | number of gauge withdrawals (unstaking) |
| `numberOfGaugeRewardClaims` | `BigInt!` | number of gauge reward claims |
| `totalGaugeRewardsClaimedUSD` | `BigInt!` | total gauge rewards claimed in USD |
| `totalGaugeRewardsClaimed` | `BigInt!` | total gauge rewards claimed in reward-token units — AERO on Base, VELO on Optimism (18-dec); single reward token per chain, coherent within a chain, NOT summable across chains (see #813) |
| `currentLiquidityStaked` | `BigInt!` | current liquidity staked in gauge in token units |
| `currentLiquidityStakedUSD` | `BigInt!` | current liquidity staked in gauge in USD |
| `timestamp` | `Timestamp!` | timestamp of last update |
| `feeProtocol0` | `BigInt` | protocol fee % for token0. Set via SetFeeProtocol (governance-gated admin call). Uniformly 0 across all Slipstream pools as of 2026-05: Aerodrome/Velodrome governance has not activated protocol fees. The handler (src/EventHandlers/CLPool.ts) is wired correctly; the field will populate only when (and if) governance turns the toggle on. Slipstream's slot0() does not pack feeProtocol and the pool exposes no feeProtocol() getter, so the on-chain SetFeeProtocol event is the only source. |
| `feeProtocol1` | `BigInt` | As feeProtocol0, for token1. |
| `observationCardinalityNext` | `BigInt` | oracle observation cardinality |
| `sqrtPriceX96` | `BigInt` | current sqrt price (Q96 fixed point) - updated from Swap/Initialize events |
| `tick` | `BigInt` | current tick - updated from Swap/Initialize events |
| `liquidityInRange` | `BigInt` | active-tick in-range liquidity L. Recomputed on Swap; bumped on Mint/Burn when tickLower <= currentTick < tickUpper. |
| `stakedLiquidityInRange` | `BigInt` | staked in-range liquidity L |
| `stakedReserve0` | `BigInt` | staked reserves in token0 raw units |
| `stakedReserve1` | `BigInt` | staked reserves in token1 raw units |
| `totalFlashLoanFees0` | `BigInt` | total flash loan fees collected in token0 |
| `totalFlashLoanFees1` | `BigInt` | total flash loan fees collected in token1 |
| `totalFlashLoanFeesUSD` | `BigInt` | total flash loan fees collected in USD |
| `totalFlashLoanVolumeUSD` | `BigInt` | total flash loan volume in USD |
| `numberOfFlashLoans` | `BigInt` | total number of flash loans |
| `bribeVotingRewardAddress` | `String` | address of the bribe voting reward contract for this pool _(indexed)_ |
| `totalBribeClaimedUSD` | `BigInt!` | total bribes claimed by users in USD (canonical cross-token aggregate; raw token-unit sum dropped in #813 — bribes are arbitrary heterogeneous tokens) |
| `feeVotingRewardAddress` | `String` | address of the fee voting reward contract for this pool _(indexed)_ |
| `totalFeeRewardClaimedUSD` | `BigInt!` | total fee rewards claimed by users in USD (canonical cross-token aggregate; raw token-unit sum dropped in #813 — fee rewards mix the pool's two fee tokens) |
| `veNFTamountStaked` | `BigInt!` | total amount of veNFT staked for this pool |
| `baseFee` | `BigInt!` | Current base fee, FEE_SCALE 1e6 (hundredths of a basis point); single fee divisor across V2 & CL — issue #812 |
| `feeCap` | `BigInt` | Current fee cap for pool |
| `scalingFactor` | `BigInt` | Current scaling factor for pool |
| `currentFee` | `BigInt!` | Current fee (base + dynamic), FEE_SCALE 1e6; single fee divisor across V2 & CL — issue #812 |
| `unstakedFee` | `BigInt` | Raw customFee value last emitted by an UnstakedFeeModule for this pool (see Pool for semantics) |

### TokenPriceSnapshot

Snapshot of the Token entity

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{address}-{blockNumber} (TokenIdByBlock) |
| `address` | `String!` | Address of the token _(indexed)_ |
| `pricePerUSDNew` | `BigInt!` | price of token per USD |
| `chainId` | `Int!` | chain id |
| `isWhitelisted` | `Boolean!` | whether the token is whitelisted |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp of the last update _(indexed)_ |

### UserStatsPerPoolSnapshot

Snapshot of UserStatsPerPool at an epoch (invariant fields + position params for recomputation)

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{userAddress}-{poolAddress}-{epochMs} (UserStatsPerPoolSnapshotId) |
| `userAddress` | `String!` | user wallet address _(indexed)_ |
| `poolAddress` | `String!` | address of the pool these stats are scoped to _(indexed)_ |
| `chainId` | `Int!` | chain id |
| `timestamp` | `Timestamp!` | snapshot epoch timestamp _(indexed)_ |
| `lpBalance` | `BigInt!` | user's LP token balance at snapshot time |
| `totalLiquidityAddedUSD` | `BigInt!` | cumulative USD value of liquidity added |
| `totalLiquidityAddedToken0` | `BigInt!` | cumulative raw token0 amount added |
| `totalLiquidityAddedToken1` | `BigInt!` | cumulative raw token1 amount added |
| `totalLiquidityRemovedUSD` | `BigInt!` | cumulative USD value of liquidity removed |
| `totalLiquidityRemovedToken0` | `BigInt!` | cumulative raw token0 amount removed |
| `totalLiquidityRemovedToken1` | `BigInt!` | cumulative raw token1 amount removed |
| `numberOfSwaps` | `BigInt!` | number of swaps the user made in this pool |
| `totalSwapVolumeAmount0` | `BigInt!` | swap volume denominated in token0 in this pool |
| `totalSwapVolumeAmount1` | `BigInt!` | swap volume denominated in token1 in this pool |
| `totalSwapVolumeUSD` | `BigInt!` | swap volume in USD in this pool |
| `totalFeesContributedUSD` | `BigInt!` | total fees contributed in USD (fees paid by the user in swaps) |
| `totalFeesContributed0` | `BigInt!` | total fees contributed in token0, 1e18-normalized (same scale on V2 & CL — issue #812) |
| `totalFeesContributed1` | `BigInt!` | total fees contributed in token1, 1e18-normalized (same scale on V2 & CL — issue #812) |
| `numberOfFlashLoans` | `BigInt!` | number of flash loan swaps in this pool |
| `totalFlashLoanVolumeUSD` | `BigInt!` | flash loan swap volume in USD in this pool |
| `numberOfGaugeDeposits` | `BigInt!` | number of gauge deposits (staking) |
| `numberOfGaugeWithdrawals` | `BigInt!` | number of gauge withdrawals (unstaking) |
| `numberOfGaugeRewardClaims` | `BigInt!` | number of gauge reward claims |
| `totalGaugeRewardsClaimedUSD` | `BigInt!` | total gauge rewards claimed in USD |
| `totalGaugeRewardsClaimed` | `BigInt!` | total gauge rewards claimed in reward-token units — AERO on Base, VELO on Optimism (18-dec); single reward token per chain, coherent within a chain, NOT summable across chains (see #813) |
| `totalStakedFeesCollected0` | `BigInt!` | pool fees (token0) collected by this user from staked position (CollectFees) |
| `totalStakedFeesCollected1` | `BigInt!` | pool fees (token1) collected by this user from staked position (CollectFees) |
| `totalStakedFeesCollectedUSD` | `BigInt!` | pool fees in USD collected by this user from staked position (CollectFees) |
| `totalUnstakedFeesCollected0` | `BigInt!` | pool fees (token0) collected by this user from unstaked position (Collect) |
| `totalUnstakedFeesCollected1` | `BigInt!` | pool fees (token1) collected by this user from unstaked position (Collect) |
| `totalUnstakedFeesCollectedUSD` | `BigInt!` | pool fees in USD collected by this user from unstaked position (Collect) |
| `currentLiquidityStaked` | `BigInt!` | current liquidity staked in gauge in token units |
| `currentLiquidityStakedUSD` | `BigInt!` | current liquidity staked in gauge in USD, captured at snapshot time. Carries the same as-of-last-activity caveat as `UserStatsPerPool.currentLiquidityStakedUSD` (issue #902): per-user snapshots are written only when the user is active, so an idle staker yields no fresh rows and the value is whatever it was at their last action (often `0`). For valuation use `currentLiquidityStaked` units or pool-level staked-USD. |
| `stakedCLPositionTokenIds` | `[BigInt!]!` | tokenIds of CL positions staked in gauge at snapshot time |
| `totalBribeClaimedUSD` | `BigInt!` | total USD value of bribe rewards claimed by this user for this pool (canonical cross-token aggregate; raw token-unit sum dropped in #813 — bribes are arbitrary heterogeneous tokens) |
| `totalFeeRewardClaimedUSD` | `BigInt!` | total USD value of fee rewards claimed by this user for this pool (canonical cross-token aggregate; raw token-unit sum dropped in #813 — fee rewards mix the pool's two fee tokens) |
| `veNFTamountStaked` | `BigInt!` | amount of veNFT staked by this user for this pool |
| `almAddress` | `String!` | Address of ALM LP Wrapper the user interacts with (empty string if none) |
| `almLpAmount` | `BigInt!` | Number of ALM LP tokens held by the user |
| `lastAlmActivityTimestamp` | `Timestamp!` | last ALM-related activity timestamp |
| `lastActivityTimestamp` | `Timestamp!` | last activity in this pool |

### NonFungiblePositionSnapshot

Snapshot of NonFungiblePosition at an epoch (full state for historical queries / recomputation)

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{nfpmAddress}-{tokenId}-{epochMs} (NonFungiblePositionSnapshotId). nfpmAddress disambiguates intra-chain tokenId collisions across multiple NFPMs (e.g. Optimism has two). |
| `chainId` | `Int!` | chain id where the NFT exists |
| `tokenId` | `BigInt!` | token ID of the NFT _(indexed)_ |
| `nfpmAddress` | `String!` | address of the NFPM contract that emitted the Transfer _(indexed)_ |
| `owner` | `String!` | checksum address of the owner at snapshot time _(indexed)_ |
| `pool` | `String!` | address of the CL pool this position belongs to _(indexed)_ |
| `tickLower` | `BigInt!` | lower tick of the position range |
| `tickUpper` | `BigInt!` | upper tick of the position range |
| `token0` | `String!` | address of token0 in the position |
| `token1` | `String!` | address of token1 in the position |
| `liquidity` | `BigInt!` | liquidity value of the position at snapshot time |
| `mintTransactionHash` | `String!` | transaction hash of the NFT mint transaction _(indexed)_ |
| `mintLogIndex` | `Int!` | log index of the CLPool.Mint event (for placeholder matching) |
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last update before this snapshot |
| `isStakedInGauge` | `Boolean!` | whether the position is staked in the pool's gauge at snapshot time |
| `timestamp` | `Timestamp!` | snapshot epoch timestamp _(indexed)_ |

### VeNFTStateSnapshot

Snapshot of VeNFTState at an epoch (full state for historical queries)

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId}-{epochMs} (VeNFTStateSnapshotId) |
| `chainId` | `Int!` | chain id |
| `tokenId` | `BigInt!` | veNFT token ID _(indexed)_ |
| `owner` | `String!` | owner address at snapshot time _(indexed)_ |
| `locktime` | `BigInt!` | lock expiry timestamp (seconds); 0 for permanent locks |
| `isPermanent` | `Boolean!` | whether the lock is permanent (never expires) |
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last update before this snapshot |
| `totalValueLocked` | `BigInt!` | amount of governance token locked in the veNFT |
| `isAlive` | `Boolean!` | whether the veNFT still exists at snapshot time |
| `timestamp` | `Timestamp!` | snapshot epoch timestamp _(indexed)_ |
| `votesPerPool` | `[VeNFTPoolVoteSnapshot!]!` | reverse relation: this veNFT's per-pool vote allocations at snapshot time _(derived)_ |

### VeNFTPoolVoteSnapshot

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId}-{poolAddress}-{epochMs} |
| `chainId` | `Int!` | chain id |
| `tokenId` | `BigInt!` | veNFT token ID |
| `poolAddress` | `String!` | pool this veNFT allocated votes to _(indexed)_ |
| `veNFTamountStaked` | `BigInt!` | vote weight allocated to the pool, in veToken units |
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last update before this snapshot |
| `timestamp` | `Timestamp!` | snapshot epoch timestamp _(indexed)_ |
| `veNFTStateSnapshot` | `VeNFTStateSnapshot!` | the veNFT-state snapshot this vote belongs to _(indexed)_ |

### ALM_LP_WrapperSnapshot

Snapshot of ALM_LP_Wrapper at an epoch (full state for historical queries / recomputation)

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{wrapperAddress}-{epochMs} (ALMLPWrapperSnapshotId) |
| `wrapper` | `String!` | address of the ALM LP wrapper _(indexed)_ |
| `pool` | `String!` | address of the pool this wrapper is associated with _(indexed)_ |
| `chainId` | `Int!` | chain id |
| `token0` | `String!` | address of token0 |
| `token1` | `String!` | address of token1 |
| `lpAmount` | `BigInt!` | total LP tokens wrapped at snapshot time |
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last update before this snapshot |
| `tokenId` | `BigInt!` | strategy/position tokenId _(indexed)_ |
| `tickLower` | `BigInt!` | lower tick bound of the position's price range |
| `tickUpper` | `BigInt!` | upper tick bound of the position's price range |
| `property` | `BigInt!` | pool property parameter from the AMM position struct |
| `liquidity` | `BigInt!` | liquidity currently in the AMM position |
| `strategyType` | `BigInt!` | type/kind of ALM strategy in use |
| `tickNeighborhood` | `BigInt!` | tick neighborhood parameter for the strategy |
| `tickSpacing` | `BigInt!` | tick spacing for the strategy |
| `positionWidth` | `BigInt!` | width parameter for the strategy (position size in ticks) |
| `maxLiquidityRatioDeviationX96` | `BigInt!` | max allowed liquidity ratio deviation (X96 fixed point) |
| `creationTimestamp` | `Timestamp!` | timestamp when the strategy was created |
| `strategyTransactionHash` | `String!` | transaction hash of the StrategyCreated event _(indexed)_ |
| `timestamp` | `Timestamp!` | snapshot epoch timestamp _(indexed)_ |

## Config & registry

Chain-wide configuration and cross-chain mapping tables.

### FactoryRegistryConfig

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {srcAddress}_{chainId} (factory registry contract address) |
| `currentActivePoolFactory` | `String!` | Address of the currently active pool factory (creates vAMM/sAMM or CL pools) |
| `currentActiveVotingRewardsFactory` | `String!` | Address of the currently active voting rewards factory (creates fee and bribe voting reward contracts) |
| `currentActiveGaugeFactory` | `String!` | Address of the currently active gauge factory (creates gauge contracts for emissions) |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp when the factory registry configuration was last updated |

### DynamicFeeGlobalConfig

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: contract address (DynamicSwapFeeModule) |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `secondsAgo` | `BigInt` | The amount of time used to calculate price change |

### CLGaugeConfig

Stores chain-wide CLGauge config data — default emissions cap, default min-stake-time, and penalty rate. Keyed by chainId so the CLFactory.PoolCreated handler can resolve it with a direct get() without a per-chain lookup constant. Last-writer-wins across gauge factory generations (V2, V3, ...) — the row reflects the most recent chain-wide defaults.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: stringified chainId (e.g. "8453" for Base) |
| `defaultEmissionsCap` | `BigInt!` | Chain-wide default gauge emissions cap; applied when a pool's gauge has no SetEmissionsCap override. |
| `defaultMinStakeTime` | `BigInt!` | Chain-wide default LP stake lockup (seconds), set via CLGaugeFactoryV3.SetDefaultMinStakeTime. 0 before V3. |
| `penaltyRate` | `BigInt!` | Early-unstake penalty rate in basis points, set via CLGaugeFactoryV3.SetPenaltyRate. 0 before V3. |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp of the last CLGaugeConfig update |

### FeeToTickSpacingMapping

Should be updated by TickSpacingEnabled event emitted by CLFactory contract It allows to initialise currentFee field for all CLPools CLPool fees can then be modified by either CustomSwapFeeModule or DynamicSwapFeeModule The same tick spacing can be enabled multiple times (to update the fee), so this entity is updated, not created new

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tickSpacing} (FeeToTickSpacingMappingId) |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `tickSpacing` | `BigInt!` | Tick spacing value _(indexed)_ |
| `fee` | `BigInt!` | Fee value for this tick spacing |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp when this mapping was last updated |

### RedistributorConfig

Singleton config state per Redistributor contract, updated by SetKeeper / SetUpkeepManager events. Last-writer-wins — the row reflects the most recent keeper / upkeep manager addresses. Redistributed and Deposited events are folded into Pool counters (totalEmissionsRedistributed / totalEmissionsForfeited) via a gauge→pool lookup; they have no dedicated entity.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{redistributorAddress} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `redistributorAddress` | `String!` | Redistributor contract address |
| `keeper` | `String!` | Current keeper address (empty string until SetKeeper fires) |
| `upkeepManager` | `String!` | Current upkeep manager address (empty string until SetUpkeepManager fires) |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp of the last config update |

### RootPool_LeafPool

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {rootChainId}-{leafChainId}-{rootPoolAddress}-{leafPoolAddress} (RootPoolLeafPoolId) |
| `rootChainId` | `Int!` | Optimism chain ID |
| `rootPoolAddress` | `String!` | Placeholder contract that isn't a real pool (i.e., doesn't allow for LP, swap, etc). Mainly just for registring purposes _(indexed)_ |
| `leafChainId` | `Int!` | Chain ID where the actual real pool (i.e. pool where it is possible to LP, swap, etc) is deployed |
| `leafPoolAddress` | `String!` | Actual real pool that is deployed on leaf chain |

### RootGauge_RootPool

Maps root gauge (RootGauge/RootCLGauge on OP) to root pool for DistributeReward cross-chain resolution

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Unique identifier, formatted as {rootChainId}-{rootGaugeAddress} |
| `rootChainId` | `Int!` | Chain ID of the root chain (typically Optimism) |
| `rootGaugeAddress` | `String!` | Address of the root gauge contract on the root chain _(indexed)_ |
| `rootPoolAddress` | `String!` | Address of the root pool this gauge maps to |

## Pool launcher

Emerging-token pools created or migrated via the Pool Launcher.

### PoolLauncherPool

One per underlying pool (per chain) launched or migrated via Pool Launcher

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{underlyingPool} |
| `chainId` | `Int!` | chain id |
| `underlyingPool` | `Bytes!` | pool address |
| `launcher` | `String!` | PoolLauncher contract address (the one that created or currently manages) |
| `creator` | `String!` | msg.sender at Launch |
| `poolLauncherToken` | `Bytes!` | the "project" token |
| `pairToken` | `Bytes!` | whitelisted pair (e.g., WETH, USDC) |
| `createdAt` | `Timestamp!` | timestamp the pool was launched |
| `isEmerging` | `Boolean!` | current flag |
| `lastFlagUpdateAt` | `Timestamp!` | timestamp of last flag change |
| `migratedFrom` | `String!` | previous underlying pool (if this was target in Migrate) |
| `migratedTo` | `String!` | next underlying pool (if later migrated away) |
| `oldLocker` | `String!` | source locker in migration |
| `newLocker` | `String!` | target locker from migration |
| `lastMigratedAt` | `Timestamp!` | timestamp of the most recent migration |
| `poolStats` | `[Pool!]!` | reverse relation: Pool aggregates launched under this PoolLauncherPool _(derived)_ |

### PoolLauncherConfig

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{poolLauncherAddress} (PoolId with launcher contract as address) |
| `version` | `String!` | "CL" for concentrated liquidity, "V2" for V2 pools |
| `pairableTokens` | `[String!]` | Whitelisted tokens an emerging-token pool may be paired against on this launcher |

## Cross-chain superswaps (Hyperlane)

oUSDT-bridged swaps and the Hyperlane dispatch/process events that correlate them.

### SuperSwap

A superswap is characterized by 3 steps: 1. Original asset is swapped for oUSDT on the source chain. 2. The oUSDT is then bridged through Hyperlane to the destination chain. 3. Bridged oUSDT is then swapped into the preferred asset on the destination chain.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {messageId} — globally unique Hyperlane message identifier |
| `originChainId` | `BigInt!` | Chain ID where the swap originated |
| `destinationChainId` | `BigInt!` | Chain ID of the swap target/recipient |
| `sender` | `String!` | Original sender address initiating the swap |
| `recipient` | `String!` | The recipient address on the destination chain |
| `oUSDTamount` | `BigInt!` | Amount of oUSDT swapped (already normalized to token decimals) |
| `sourceChainToken` | `String!` | Token that gets swapped by oUSDT on source chain, i.e., Token A -> oUSDT on source chain |
| `sourceChainTokenAmountSwapped` | `BigInt!` | Amount of sourceChainToken that was swapped for oUSDT on the source chain |
| `destinationChainToken` | `String!` | Token that gets swapped by oUSDT on destination chain, i.e., oUSDT -> Token B on destination chain |
| `destinationChainTokenAmountSwapped` | `BigInt!` | Amount of destinationChainToken that was received from swapping oUSDT on the destination chain |
| `timestamp` | `Timestamp!` | Block timestamp of the swap event |

### OUSDTBridgedTransaction

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: transaction hash (unique per bridge tx) |
| `transactionHash` | `String!` | Transaction hash _(indexed)_ |
| `originChainId` | `BigInt!` | Chain ID where the bridge transaction originated |
| `destinationChainId` | `BigInt!` | Chain ID where the bridge transaction is destined |
| `sender` | `String!` | Address that initiated the bridge transaction |
| `recipient` | `String!` | Address that will receive the bridged tokens |
| `amount` | `BigInt!` | Amount of oUSDT tokens being bridged |

### OUSDTSwaps

Registering each event related from/to oUSDT. Needed for filtering and eventual registration of source/destination token and corresponding amounts during superswaps execution

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {transactionHash}_{chainId}_{tokenInPool}_{amountIn}_{tokenOutPool}_{amountOut} |
| `transactionHash` | `String!` | Transaction hash of the swap transaction _(indexed)_ |
| `tokenInPool` | `String!` | Token that goes into the pool after swap |
| `tokenOutPool` | `String!` | Token that goes out of the pool after swap |
| `amountIn` | `BigInt!` | Amount of tokenInPool being swapped into the pool |
| `amountOut` | `BigInt!` | Amount of tokenOutPool being swapped out of the pool |

### DispatchId_event

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {transactionHash}_{chainId}_{messageId} |
| `chainId` | `Int!` | Chain ID where the message was dispatched (origin chain) |
| `transactionHash` | `String!` | Transaction hash of the dispatch transaction _(indexed)_ |
| `messageId` | `String!` | Unique message ID identifying the cross-chain message in Hyperlane _(indexed)_ |

### ProcessId_event

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {transactionHash}_{chainId}_{messageId} |
| `chainId` | `Int!` | Chain ID where the message was processed (destination chain) |
| `transactionHash` | `String!` | Transaction hash of the process transaction _(indexed)_ |
| `messageId` | `String!` | Unique message ID identifying the cross-chain message in Hyperlane (matches DispatchId messageId) _(indexed)_ |

## Internal buffers & deferred state

Short-lived bookkeeping entities used to correlate events across log indices/blocks. Most are deleted once consumed; not intended for end-user queries.

### PendingVote

Deferred vote: stored when Voted/Abstained fires but RootPool_LeafPool mapping does not exist yet

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{rootPoolAddress}-{tokenId}-{txHash}-{logIndex} |
| `chainId` | `Int!` | Chain ID for which the vote was intended |
| `rootPoolAddress` | `String!` | Address of the root pool being voted on _(indexed)_ |
| `tokenId` | `BigInt!` | veNFT Token ID that cast the vote |
| `weight` | `BigInt!` | Weight of the vote in veToken units |
| `eventType` | `String!` | "Voted" \| "Abstained" |
| `timestamp` | `Timestamp!` | Timestamp when the vote event occurred |
| `blockNumber` | `BigInt!` | Block number in which the vote was submitted |
| `transactionHash` | `String!` | Transaction hash of the vote event |

### CLPoolPendingInitialize

Deferred CL pool initialization state: stored when CLPool.Initialize fires BEFORE CLFactory.PoolCreated has created the Pool. Aerodrome Slipstream emits Initialize from the pool inside the same tx as (and at a LOWER log index than) PoolCreated from the factory, so Envio delivers Initialize first. PoolCreated reads this buffer when constructing the new aggregator and deletes the entry afterwards.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{poolAddress} (PoolId) |
| `chainId` | `Int!` | chain id |
| `poolAddress` | `String!` | address of the CL pool awaiting PoolCreated |
| `sqrtPriceX96` | `BigInt!` | initial sqrt price (Q96 fixed point) from the Initialize event |
| `tick` | `BigInt!` | initial tick from the Initialize event |

### PendingRootPoolMapping

Deferred RootPool->LeafPool mapping: stored when RootPoolCreated fires but no Pool exists yet

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {rootChainId}-{rootPoolAddress} |
| `rootChainId` | `Int!` | Chain ID where the root pool exists (typically Optimism) |
| `rootPoolAddress` | `String!` | Address of the root pool (matches RootPool_LeafPool) |
| `leafChainId` | `Int!` | Chain ID where the leaf pool will be created |
| `token0` | `String!` | Address of token0 in the root/leaf pool |
| `token1` | `String!` | Address of token1 in the root/leaf pool |
| `tickSpacing` | `BigInt!` | Tick spacing assigned for the pool |
| `rootPoolMatchingHash` | `String!` | {leafChainId}_{token0}_{token1}_{tickSpacing} # Used for quick matching in Pool _(indexed)_ |

### PendingDistribution

Deferred distribution: stored when DistributeReward fires for a root gauge but RootPool_LeafPool mapping does not exist yet

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {rootChainId}-{rootPoolAddress}-{blockNumber}-{logIndex} |
| `rootChainId` | `Int!` | Chain ID where the root gauge and pool exist |
| `rootPoolAddress` | `String!` | Address of the root pool (matches RootPool_LeafPool) _(indexed)_ |
| `gaugeAddress` | `String!` | Gauge that emitted DistributeReward |
| `amount` | `BigInt!` | Reward amount from event |
| `blockNumber` | `BigInt!` | Block number of the event |
| `blockTimestamp` | `Timestamp!` | Block timestamp of the event |
| `logIndex` | `Int!` | Log index for uniqueness within block |

### CLPoolMintEvent

Temporary entity for storing CLPool.Mint event data until consumed by NFPM.Transfer(mint) This is needed because NFPM.Transfer will create NonFungiblePosition entity for a mint (i.e. from = zero address) However, the transfer event doesn't have all the necessary data (e.g. tickLower, tickUpper, etc). This is where CLpoolMintEvent comes in Deleted immediately after consumption

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}_{poolAddress}_{txHash}_{logIndex} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `pool` | `String!` | address of the CL pool the Mint fired on _(indexed)_ |
| `owner` | `String!` | position owner from the Mint event |
| `tickLower` | `BigInt!` | lower tick of the minted range |
| `tickUpper` | `BigInt!` | upper tick of the minted range |
| `liquidity` | `BigInt!` | liquidity minted |
| `amount0` | `BigInt!` | raw token0 amount deposited |
| `amount1` | `BigInt!` | raw token1 amount deposited |
| `token0` | `String!` | address of token0 |
| `token1` | `String!` | address of token1 |
| `transactionHash` | `String!` | transaction hash of the Mint event _(indexed)_ |
| `logIndex` | `Int!` | log index of the Mint event within the transaction |
| `consumedByTokenId` | `BigInt` | Set when consumed (null = unconsumed) _(indexed)_ |
| `createdAt` | `Timestamp!` | timestamp the buffer row was created |

### CLPositionPendingPrincipal

Tracks burned principal per CL position that hasn't been collected yet. Used to isolate actual swap fees from the CLPool Collect event, which emits a combined amount (burned principal + accumulated fees) in tokensOwed. Flow: Burn adds principal here → Collect subtracts it → remainder = fees. Keyed by contract-level position identity (pool + owner + tick range).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | {chainId}-{poolAddress}-{owner}-{tickLower}-{tickUpper} |
| `pendingPrincipal0` | `BigInt!` | Principal from Burn events not yet drained by Collect. Accumulates across multiple Burns; reduced when Collect fires. |
| `pendingPrincipal1` | `BigInt!` | token1 counterpart of pendingPrincipal0 (see pendingPrincipal0). |

### TxCLPoolMintRegistry

Per-transaction registry of CLPoolMintEvent IDs, used to skip the index scan on CLPoolMintEvent.getWhere({ transactionHash }) in the NFPM.Transfer(mint) consumer. The consumer knows chainId + txHash; it reads this row and then PK-gets each event by id. Cleaned up as events are consumed: ids are removed on consumption and the row is deleted when the last id is removed.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash} |
| `mintEventIds` | `[String!]!` | CLPoolMintEvent ids produced in this tx, in insertion order |

### TxPoolTransferRegistry

Per-(tx, pool) registry of PoolTransferInTx ids, used to skip the index scan on PoolTransferInTx.getWhere({ txHash }) in the Pool.Mint / Pool.Burn consumer. The consumer knows chainId + txHash + pool; it reads this row and then PK-gets each transfer by id. Rows are pruned on consumption and deleted when empty.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{poolAddress} |
| `transferIds` | `[String!]!` | PoolTransferInTx ids produced in this (tx, pool), in insertion order |

### PoolTransferInTx

Temporary entity for matching Mint/Burn with Transfer events Only stores mint/burn transfers (isMint || isBurn) to reduce storage

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{poolAddress}-{logIndex} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `txHash` | `String!` | transaction hash containing the transfer _(indexed)_ |
| `pool` | `String!` | address of the pool whose LP token was transferred _(indexed)_ |
| `logIndex` | `Int!` | log index of the Transfer event within the transaction |
| `blockNumber` | `BigInt!` | block number of the transfer |
| `from` | `String!` | sender address (0x0 for mints) |
| `to` | `String!` | recipient address (0x0 for burns) |
| `value` | `BigInt!` | LP token amount transferred |
| `isMint` | `Boolean!` | from == 0x0 |
| `isBurn` | `Boolean!` | to == 0x0 |
| `timestamp` | `Timestamp!` | block timestamp of the transfer |

### ALMLPWrapperTransferInTx

Temporary entity for matching Withdraw events with Transfer events (burns) Similar to PoolTransferInTx but for ALM LP Wrapper Only needed for burns (to = 0x0) since Deposit events emit the correct minted amount Needed for LPWrapper V1 Withdraw event handler fix

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{wrapperAddress}-{logIndex} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `txHash` | `String!` | transaction hash containing the transfer _(indexed)_ |
| `wrapperAddress` | `String!` | address of the ALM LP wrapper whose token was transferred _(indexed)_ |
| `logIndex` | `Int!` | log index of the Transfer event within the transaction |
| `blockNumber` | `BigInt!` | block number of the transfer |
| `from` | `String!` | sender address (0x0 for mints) |
| `to` | `String!` | recipient address (0x0 for burns) |
| `value` | `BigInt!` | LP token amount transferred |
| `isBurn` | `Boolean!` | to == 0x0 |
| `consumedByLogIndex` | `Int` | logIndex of the Withdraw event that consumed this transfer (undefined if unused) |
| `timestamp` | `Timestamp!` | block timestamp of the transfer |

### ALM_TotalSupplyLimitUpdated_event

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{lpWrapperAddress} (ALMLPWrapperId) |
| `lpWrapperAddress` | `String!` | LP Wrapper associated to the event |
| `currentTotalSupplyLPTokens` | `BigInt!` | Current supply of LP tokens for the pool, emitted by the event |
| `transactionHash` | `String!` | Transaction hash of the event |
