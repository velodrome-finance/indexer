<!--
  AUTO-GENERATED — do not edit by hand.
  Source: schema.graphql
  Regenerate: pnpm tsx scripts/generate-schema-docs.ts
-->

# Entity & field reference

Generated from [`schema.graphql`](../schema.graphql). The schema defines **75 entity types**; each becomes a queryable table in the indexer's database.

## Reading this reference

- **`Type`** is the GraphQL type. A trailing `!` means non-nullable.
- **`BigInt`** fields are fixed-point integers (no JS number precision loss); divide by the relevant token's `decimals` (or `10^18` for USD/`WAD`-scaled values) to get a human number.
- **`Timestamp`** is an ISO-8601 / epoch timestamp; **`Bytes`**/**`String`** hold addresses and hashes.
- **_(indexed)_** marks fields with a secondary index (`@index`) — efficient to filter on. **_(derived)_** marks reverse-relation fields (`@derivedFrom`) that are computed, not stored.
- Entity `id` formats and other conventions are documented inline in each `id` row. See the [Data model](../README.md#data-model) section of the README for the high-level map.

## Contents

- **Core aggregates** — [Pool](#pool), [Token](#token), [UserStatsPerPool](#userstatsperpool), [NonFungiblePosition](#nonfungibleposition), [VeNFTState](#venftstate), [VeNFTPoolVote](#venftpoolvote), [ALM_LP_Wrapper](#alm_lp_wrapper)
- **Snapshots** — [PoolSnapshot](#poolsnapshot), [TokenPriceSnapshot](#tokenpricesnapshot), [UserStatsPerPoolSnapshot](#userstatsperpoolsnapshot), [NonFungiblePositionSnapshot](#nonfungiblepositionsnapshot), [VeNFTStateSnapshot](#venftstatesnapshot), [VeNFTPoolVoteSnapshot](#venftpoolvotesnapshot), [ALM_LP_WrapperSnapshot](#alm_lp_wrappersnapshot)
- **Config & registry** — [FactoryRegistryConfig](#factoryregistryconfig), [DynamicFeeGlobalConfig](#dynamicfeeglobalconfig), [CLGaugeConfig](#clgaugeconfig), [FeeToTickSpacingMapping](#feetotickspacingmapping), [PoolFactoryDefaultFee](#poolfactorydefaultfee), [RedistributorConfig](#redistributorconfig), [RootPool_LeafPool](#rootpool_leafpool), [RootGauge_RootPool](#rootgauge_rootpool)
- **Pool launcher** — [PoolLauncherPool](#poollauncherpool), [PoolLauncherConfig](#poollauncherconfig)
- **Cross-chain superswaps (Hyperlane)** — [SuperSwap](#superswap), [OUSDTBridgedTransaction](#ousdtbridgedtransaction), [OUSDTSwaps](#ousdtswaps), [DispatchId_event](#dispatchid_event), [ProcessId_event](#processid_event), [TxDispatchIdRegistry](#txdispatchidregistry), [TxOUSDTSwapRegistry](#txousdtswapregistry)
- **Aero gauges, staking & emissions** — [AeroGauge](#aerogauge), [AeroGaugeFactory](#aerogaugefactory), [AeroLeafVoterState](#aeroleafvoterstate), [AeroVotingRewardsManager](#aerovotingrewardsmanager), [AeroIncentiveProgram](#aeroincentiveprogram), [AeroGaugeSnapshot](#aerogaugesnapshot), [AeroLeafVoterStateSnapshot](#aeroleafvoterstatesnapshot), [AeroGaugeStakeEvent](#aerogaugestakeevent), [AeroEmissionsEvent](#aeroemissionsevent), [AeroRedemptionEvent](#aeroredemptionevent), [AeroVotingRewardsEvent](#aerovotingrewardsevent)
- **Aero governance** — [SAeroPosition](#saeroposition), [SAeroEscrowState](#saeroescrowstate), [SAeroEscrowStateSnapshot](#saeroescrowstatesnapshot), [SAeroPositionEvent](#saeropositionevent), [AeroRootAllocation](#aerorootallocation), [AeroRootGaugeVote](#aerorootgaugevote), [AeroRootChainState](#aerorootchainstate), [AeroLeafTokenState](#aeroleaftokenstate), [AeroLeafAllocation](#aeroleafallocation), [AeroAllocationEvent](#aeroallocationevent), [AeroMinterState](#aerominterstate), [AeroMinterSnapshot](#aeromintersnapshot), [AeroMinterEvent](#aerominterevent), [AeroMigrationTotals](#aeromigrationtotals), [AeroMigrationEvent](#aeromigrationevent)
- **Internal buffers & deferred state** — [PendingVote](#pendingvote), [CLPoolPendingInitialize](#clpoolpendinginitialize), [PendingRootPoolMapping](#pendingrootpoolmapping), [PendingDistribution](#pendingdistribution), [PoolTickMap](#pooltickmap), [CLPoolMintEvent](#clpoolmintevent), [CLPositionPendingPrincipal](#clpositionpendingprincipal), [TxCLPoolMintRegistry](#txclpoolmintregistry), [AeroNFPMMintPool](#aeronfpmmintpool), [AeroNFPMPendingMint](#aeronfpmpendingmint), [AeroGaugePendingReferral](#aerogaugependingreferral), [NFPMPositionPendingPrincipal](#nfpmpositionpendingprincipal), [V2SwapFeesInTx](#v2swapfeesintx), [TokenPricingPools](#tokenpricingpools), [TxPoolTransferRegistry](#txpooltransferregistry), [PoolTransferInTx](#pooltransferintx), [ALMLPWrapperTransferInTx](#almlpwrappertransferintx), [ALM_TotalSupplyLimitUpdated_event](#alm_totalsupplylimitupdated_event)

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
| `deployment` | `String!` | Which deployment created the pool (docs/adr/0005-one-data-model-for-legacy-and-aero-pools.md): VELODROME (Velodrome V2 / Slipstream on Optimism and the superchain leaves), AERODROME (Aerodrome V2 / Slipstream on Base) or AERO (the Aero / MetaDEX deployment launched 2026-10-21, every chain). Set once at PoolCreated from the factory contract that emitted it. Values pinned by POOL_DEPLOYMENT in src/Constants.ts. Fields that do not apply to AERO pools are documented per field below. _(indexed)_ |
| `createdBlockNumber` | `BigInt!` | Block number at which PoolCreated fired (#759); creation-time metadata |
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
| `numberOfSwapFeeFallbacks` | `BigInt!` | CL only: swaps whose fee could not be derived from the swap (tick-map walk disagreed with the event's liquidity, or the derived fee was negative or above 10% of the input) and were valued with the stored currentFee instead. Should stay 0 on a from-creation sync |
| `token0Price` | `BigInt!` | price of token0 relative to token1 |
| `token1Price` | `BigInt!` | price of token1 relative to token0 |
| `totalVotesDeposited` | `BigInt!` | total votes deposited in veToken units (legacy weekly Voter votes; 0 on AERO pools: Aero has no weekly votes; sAERO allocations are in AeroLeafAllocation / AeroGauge.totalAllocated) |
| `totalVotesDepositedUSD` | `BigInt!` | total votes deposited in USD (0 on AERO pools, see totalVotesDeposited) |
| `totalEmissions` | `BigInt!` | total emissions for the pool in reward token units (VELO form Optimism and AERO for Base); 18-dec, single reward token per chain — coherent within a chain, NOT cross-chain summable (see #813) |
| `totalEmissionsUSD` | `BigInt!` | total emissions for the pool in USD. totalEmissions* are legacy-gauge emissions; 0 on AERO pools (Aero emissions are minted on claim: see AeroGauge, ADR 0006) |
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
| `hasStakes` | `Boolean!` | True once any staked position has been recorded for this pool. Gates the per-swap staked-tick sweep in processTickCrossings: pools that have never been staked skip the sweep entirely. Set on the first gauge Deposit. One-way latch: does NOT clear if every staked position is later withdrawn. The per-tick maps themselves live on PoolTickMap (Postgres only). |
| `totalFlashLoanFees0` | `BigInt` | total flash loan fees collected in token0 |
| `totalFlashLoanFees1` | `BigInt` | total flash loan fees collected in token1 |
| `totalFlashLoanFeesUSD` | `BigInt` | total flash loan fees collected in USD |
| `totalFlashLoanVolumeUSD` | `BigInt` | total flash loan volume in USD |
| `numberOfFlashLoans` | `BigInt` | total number of flash loans |
| `gaugeIsAlive` | `Boolean!` | whether the gauge is alive. On AERO pools: the Aero gauge is activated on its LeafVoter and its emission cap is not 0 (ADR 0006). Of the gauge fields below, gaugeAddress, the deposit / withdrawal counts and currentLiquidityStaked* apply to AERO pools; gaugeEmissionsCap, minStakeTime and the reward-claim / emission fields are legacy-only (see AeroGauge) |
| `gaugeAddress` | `String` | address of the gauge for this pool _(indexed)_ |
| `gaugeEmissionsCap` | `BigInt` | Emissions cap for gauge. If not specified in an SetEmissionsCap event, set to defaultEmissionsCap as per CLGaugeConfig. If CLGaugeConfig doesn't exist, there's no emissions cap. Null on AERO pools (CLGaugeConfig is the legacy CLGaugeFactory's) |
| `minStakeTime` | `BigInt!` | Per-pool LP stake lockup (seconds). Seeded from CLGaugeConfig.defaultMinStakeTime at pool creation; overridden by CLGaugeFactoryV3.SetPoolMinStakeTime. 0 before V3. 0 on AERO pools (legacy CLGaugeFactory setting) |
| `numberOfGaugeDeposits` | `BigInt!` | number of gauge deposits (staking) |
| `numberOfGaugeWithdrawals` | `BigInt!` | number of gauge withdrawals (unstaking) |
| `numberOfGaugeRewardClaims` | `BigInt!` | number of gauge reward claims |
| `totalGaugeRewardsClaimedUSD` | `BigInt!` | total gauge rewards claimed in USD |
| `totalGaugeRewardsClaimed` | `BigInt!` | total gauge rewards claimed in reward-token units — AERO on Base, VELO on Optimism (18-dec); single reward token per chain, coherent within a chain, NOT summable across chains (see #813) |
| `currentLiquidityStaked` | `BigInt!` | current liquidity staked in gauge in token units |
| `currentLiquidityStakedUSD` | `BigInt!` | current liquidity staked in gauge in USD (pool-level). For **CL** pools this is kept current — recomputed from staked reserves at each snapshot (`Pool.ts`, `isCL` gate). For **V2** pools it is set at gauge-event time and not repriced, so it can go stale on price moves between gauge events (#899). Either way it updates independently of the per-user `UserStatsPerPool.currentLiquidityStakedUSD`, which is as-of-last-activity (see #902). |
| `bribeVotingRewardAddress` | `String` | address of the bribe voting reward contract for this pool _(indexed)_ |
| `totalBribeClaimedUSD` | `BigInt!` | total bribes claimed by users in USD (canonical cross-token aggregate; raw token-unit sum dropped in #813 — bribes are arbitrary heterogeneous tokens) |
| `feeVotingRewardAddress` | `String` | address of the fee voting reward contract for this pool _(indexed)_ |
| `totalFeeRewardClaimedUSD` | `BigInt!` | total fee rewards claimed by users in USD (canonical cross-token aggregate; raw token-unit sum dropped in #813 — fee rewards mix the pool's two fee tokens) |
| `veNFTamountStaked` | `BigInt!` | total amount of veNFT staked for this pool (legacy voting rewards; 0 on AERO pools) |
| `baseFee` | `BigInt!` | Configured (nominal) fee, FEE_SCALE 1e6 (hundredths of a basis point; single divisor across V2 & CL, issue #812). V2: factory default (PoolFactoryDefaultFee) or SetCustomFee (factory or V2 CustomFeeModule). CL: tick-spacing default, CustomSwapFeeModule fee, or DynamicSwapFeeModule custom base fee (a dynamic pool charges this plus a TWAP-volatility part, up to feeCap). Custom-fee sentinels resolved as the contracts do: 420 = 0%, 0 = default (ADR 0001) |
| `feeCap` | `BigInt` | Current fee cap for pool |
| `scalingFactor` | `BigInt` | Current scaling factor for pool |
| `currentFee` | `BigInt!` | Fee rate charged, FEE_SCALE 1e6 (issue #812). AERO pools: as V2 / CL; the CL base fee comes from the DynamicSwapFeeHook (CustomFeeSet; 0 and the hook's zero-fee indicator both mean the static tick-spacing fee), feeCap / scalingFactor from its FeeCapSet / ScalingFactorSet; the V2 custom fee from the V2 CustomFeeModules. V2: effective rate of the latest swap with input >= 1e7 raw units, from the swap's own Fees amount (fee / amountIn, rounded to the nearest basis point); seeded from baseFee at creation and on SetCustomFee. CL: effective rate of the latest swap with input >= 1e7 raw units, derived from the swap itself ((amountIn - principal) / amountIn, rounded to nearest); seeded from baseFee at creation and on CustomSwapFeeModule.SetCustomFee; also the fallback rate for a swap whose fee cannot be derived (ADR 0001) |
| `unstakedFee` | `BigInt` | Raw customFee value last emitted by an UnstakedFeeModule for this pool (CL pools only). 0 = no override (factory default applies), 420 = explicit 0% fee (ZERO_FEE_INDICATOR), else fee rate with 6-decimal precision (e.g. 500_000 = 50%). Null = never set. On AERO pools set by Aero's CustomUnstakedFeeModule (same semantics; AeroUnstakedFeeModule). |
| `poolLauncherPoolId` | `String` | ID of the PoolLauncherPool entity if this pool was launched via Pool Launcher (legacy launchers only) |
| `factoryAddress` | `String` | Address of the factory that created this pool (e.g. CLFactory for CL pools, set from PoolCreated event) |
| `nfpmAddress` | `String` | Address of the NFPM contract that mints positions for this CL pool. Null for V2 (non-CL) pools. Resolved from (chainId, factoryAddress) via nfpmForCLPool in Constants.ts. Used by downstream consumers (gauges, user-stats, NFPM handlers) to derive the correct NFPM without a separate scan. _(indexed)_ |
| `rootPoolMatchingHash` | `String` | {chainId}_{token0_address}_{token1_address}_{tickSpacing} _(indexed)_ |

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
| `lastUpdatedTimestamp` | `Timestamp!` | timestamp of last price refresh attempt (drives the once-per-clock-hour throttle; see src/PriceOracle.ts) |
| `lastSuccessfulPriceTimestamp` | `Timestamp` | timestamp of last successful price (pinned / pool route / canonical source); drives the 7-day carry window (#694, docs/adr/0003) |
| `pricingDepthUSD` | `BigInt` | USD depth (1e18-base) behind pricePerUSDNew: the counterparty-side reserve of the pool that priced it, or the canonical source's own depth; kept while carried, unset when pinned / unpriced / overridden. Lets a cross-chain canonical source be compared with local pools (docs/adr/0004) |
| `isWhitelisted` | `Boolean!` | whether the token is whitelisted by the legacy Voter / SuperchainLeafVoter (WhitelistToken) |
| `isListedOnAero` | `Boolean` | Aero listing: the latest ListingSet of the chain's Aero TokenRegistry (Aero's curated token list, the successor of the legacy whitelist). Null when the registry never emitted one for the token. A positive price-trust signal like isWhitelisted (priceTrustReason LISTED, ADR 0005). |
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
| `totalLiquidityAddedUSD` | `BigInt!` | cumulative USD value of liquidity added (from IncreaseLiquidity events, V2 Transfer ADD attribution, V2 superchain-leaf 4-arg Mint recipient (#886), and direct non-NFPM CLPool.Mint). Tracks capital contribution, not LP ownership — may diverge from lpBalance for users who receive/send LP tokens via plain Transfer |
| `totalLiquidityAddedToken0` | `BigInt!` | cumulative raw token0 amount added (sum of event.params.amount0 from IncreaseLiquidity + V2 Transfer ADD + V2 superchain-leaf 4-arg Mint (#886) + direct non-NFPM CLPool.Mint). May differ from removed due to price movement between deposit and withdrawal |
| `totalLiquidityAddedToken1` | `BigInt!` | cumulative raw token1 amount added (sum of event.params.amount1 from IncreaseLiquidity + V2 Transfer ADD + V2 superchain-leaf 4-arg Mint (#886) + direct non-NFPM CLPool.Mint). May differ from removed due to price movement between deposit and withdrawal |
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
| `currentLiquidityStakedUSD` | `BigInt!` | current liquidity staked in gauge in USD — **as-of-last-activity, not current** (issue #902). The USD valuation is recomputed only at hourly snapshot time, and that recompute fires only when one of this user's own events crosses an epoch (Envio has no background cron; `UserStatsPerPool.ts` gates it on `shouldSnapshot`). An idle staker is never revalued, so the figure stays frozen at their last action — often `$0` while a real, valuable position is still staked. Summed across users it under-counts pool staked-USD by ~12–31%. For a current per-user figure, read staked units (`currentLiquidityStaked`) and value them yourself, or use pool-level `Pool.currentLiquidityStakedUSD` (live for CL pools — V2 pool-level has its own staleness, #899). Treat `$0` as possibly stale, not "no stake". Computing this at gauge deposit/withdraw time (those handlers already load pool, tokens, and position) is a possible follow-up (#902). |
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
| `nfpmAddress` | `String!` | Address of the NFPM contract that emitted the Transfer (a legacy NFPM or the Aero NFPM); disambiguates intra-chain tokenId collisions across multiple NFPMs (e.g. Optimism has two) _(indexed)_ |
| `owner` | `String!` | Checksum address of the current owner (from Transfer event) _(indexed)_ |
| `pool` | `String!` | Address of the CL pool this position belongs to _(indexed)_ |
| `tickUpper` | `BigInt!` | Upper tick of the position range |
| `tickLower` | `BigInt!` | Lower tick of the position range |
| `token0` | `String!` | Address of token0 in the position |
| `token1` | `String!` | Address of token1 in the position |
| `liquidity` | `BigInt!` | Current liquidity value of the position |
| `mintTransactionHash` | `String!` | Transaction hash of the NFT mint transaction _(indexed)_ |
| `mintLogIndex` | `Int!` | Log index of the CLPool.Mint the position was created from (legacy NFPMs: matched at NFPM.Transfer; Aero NFPM: matched at IncreaseLiquidity by range, liquidity and amounts) |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp of last update |
| `lastSnapshotTimestamp` | `Timestamp` | nullable - null means never snapshotted |
| `isStakedInGauge` | `Boolean!` | Set from NFPM.Transfer to/from the pool's gauge; owner is not updated on gauge transfers so we need this to know staked vs not. Works the same for Aero positions: Pool.gaugeAddress is set from the Aero gauge factory (ADR 0006) |

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
| `deployment` | `String!` | Pool.deployment (VELODROME / AERODROME / AERO), copied so snapshots can be filtered by deployment |
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
| `baseFee` | `BigInt!` | Configured (nominal) fee, FEE_SCALE 1e6 (hundredths of a basis point; single divisor across V2 & CL, issue #812). V2: factory default (PoolFactoryDefaultFee) or SetCustomFee (factory or V2 CustomFeeModule). CL: tick-spacing default, CustomSwapFeeModule fee, or DynamicSwapFeeModule custom base fee (a dynamic pool charges this plus a TWAP-volatility part, up to feeCap). Custom-fee sentinels resolved as the contracts do: 420 = 0%, 0 = default (ADR 0001) |
| `feeCap` | `BigInt` | Current fee cap for pool |
| `scalingFactor` | `BigInt` | Current scaling factor for pool |
| `currentFee` | `BigInt!` | Fee rate charged, FEE_SCALE 1e6 (issue #812). V2: effective rate of the latest swap with input >= 1e7 raw units, from the swap's own Fees amount (fee / amountIn, rounded to the nearest basis point); seeded from baseFee at creation and on SetCustomFee. CL: effective rate of the latest swap with input >= 1e7 raw units, derived from the swap itself ((amountIn - principal) / amountIn, rounded to nearest); seeded from baseFee at creation and on CustomSwapFeeModule.SetCustomFee; also the fallback rate for a swap whose fee cannot be derived (ADR 0001) |
| `unstakedFee` | `BigInt` | Raw customFee value last emitted by an UnstakedFeeModule for this pool (see Pool for semantics) |

### TokenPriceSnapshot

Snapshot of the Token entity, written at most once per token per clock hour by the price refresh in src/PriceOracle.ts (docs/adr/0003-pool-derived-token-prices.md).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{address}-{epochMs} (TokenPriceSnapshotId; epochMs = hour bucket of the refresh). Rows written before ADR 0003 used {chainId}-{address}-{blockNumber}. |
| `address` | `String!` | Address of the token _(indexed)_ |
| `pricePerUSDNew` | `BigInt!` | price of token per USD |
| `chainId` | `Int!` | chain id |
| `isWhitelisted` | `Boolean!` | whether the token is whitelisted |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp of the last update _(indexed)_ |
| `priceSource` | `String` | Provenance of pricePerUSDNew for this tick (ADR 0003): `pinned` (stablecoin / destination token at exactly $1), `pool` (derived from the deepest qualifying pool; see pricingPoolId / pricingDepthUSD), `canonical` (the same asset's price on its canonical chain won the depth comparison; see pricingSourceTokenId / pricingDepthUSD, ADR 0004), `override` (operator blacklist -> 0), `carried` (no route qualified; prior price kept, last success < 7 days ago, any age for the chain's WETH; see lastSuccessfulPriceTimestamp) or `unpriced` (no route qualified and nothing fresh to carry -> 0). Earlier rows may carry `rebind` (ADR 0003 fallback copy) or the oracle-era tags `fresh` / `pool-implied`, or no tag at all. Stored as String (not an enum) so the set can extend without an Envio schema migration; the value set is pinned by PRICE_SOURCE in src/Snapshots/TokenPriceSnapshot.ts. |
| `pricingPoolId` | `String` | Pool id ({chainId}-{poolAddress}) the price was derived through; set only when priceSource = `pool` |
| `pricingDepthUSD` | `BigInt` | USD depth (1e18-base) of the winning candidate: pricingPoolId's counterparty-side reserve, or the canonical source token's stored depth; set only when priceSource = `pool` or `canonical` |
| `pricingSourceTokenId` | `String` | Token id ({chainId}-{address}) of the canonical source whose stored price was used; set only when priceSource = `canonical` |
| `pricingHops` | `Int` | Route length when priceSource = `pool` / `canonical`: 1 = direct (pool against a lower-tier token, or canonical source), 2 = two-hop through a tier-3 peer that has a direct pool route (ADR 0007); then pricingPoolId is the peer pool and pricingDepthUSD the weaker of the two hops |
| `pricingViaTokenId` | `String` | Two-hop only: token id ({chainId}-{address}) of the tier-3 peer the price went through |
| `pricingViaPoolId` | `String` | Two-hop only: pool id of the peer's own direct route |
| `lastSuccessfulPriceTimestamp` | `Timestamp` | When the price in this row was last obtained: the row's own time on `pinned` / `pool` / `canonical` rows, older on `carried` rows. The chain's WETH (tier 1) carries without expiry, so a `carried` WETH row can be weeks old (ADR 0007); null on rows written before it existed |

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
| `currentLiquidityStakedUSD` | `BigInt!` | current liquidity staked in gauge in USD, captured at snapshot time. Carries the same as-of-last-activity caveat as `UserStatsPerPool.currentLiquidityStakedUSD` (issue #902): per-user snapshots are written only when the user is active, so an idle staker yields no fresh rows and the value is whatever it was at their last action (often `$0`). For valuation use `currentLiquidityStaked` units or pool-level staked-USD (live for CL pools; #899 for V2). |
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

Should be updated by TickSpacingEnabled event emitted by CLFactory contract It allows to initialise currentFee field for all CLPools CLPool fees can then be modified by either CustomSwapFeeModule or DynamicSwapFeeModule The same tick spacing can be enabled multiple times (to update the fee), so this entity is updated, not created new Keyed per CLFactory: a chain can have several CLFactories with different fees for the same tick spacing (on Arc, tick spacing 50 is 0.05% on the lite-launch CLFactory, 0.30% on the Aero one).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{factoryAddress}-{tickSpacing} (FeeToTickSpacingMappingId) |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `factoryAddress` | `String!` | CLFactory (legacy CLFactory or AeroCLFactory) that emitted TickSpacingEnabled _(indexed)_ |
| `tickSpacing` | `BigInt!` | Tick spacing value _(indexed)_ |
| `fee` | `BigInt!` | Fee value for this tick spacing |
| `lastUpdatedTimestamp` | `Timestamp!` | Timestamp when this mapping was last updated |

### PoolFactoryDefaultFee

Default fee of a V2 pool factory for one pool type, from its SetDefaultFee events (leaf PoolFactory: SetDefaultFee(bool stable, uint256 fee); Aero stable / volatile factories: SetDefaultFee(uint256)). A pool without a custom fee is charged this. Factories that never emitted one (the Optimism and Base PoolFactory) use the 5 / 30 bps constants.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{factoryAddress}-{stable\|volatile} (PoolFactoryDefaultFeeId) |
| `chainId` | `Int!` | chain id |
| `factoryAddress` | `String!` | V2 pool factory that emitted SetDefaultFee _(indexed)_ |
| `isStable` | `Boolean!` | pool type the default applies to |
| `fee` | `BigInt!` | default fee, FEE_SCALE 1e6 (the event's basis points x 100) |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the latest SetDefaultFee |

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
| `pairableTokens` | `[String!]!` | Whitelisted tokens an emerging-token pool may be paired against on this launcher |

## Cross-chain superswaps (Hyperlane)

oUSDT-bridged swaps and the Hyperlane dispatch/process events that correlate them.

### SuperSwap

A superswap is characterized by 3 steps: 1. Original asset is swapped for oUSDT on the source chain. 2. The oUSDT is then bridged through Hyperlane to the destination chain. 3. Bridged oUSDT is then swapped into the preferred asset on the destination chain.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {messageId} — globally unique Hyperlane message identifier |
| `originChainId` | `BigInt!` | Chain ID where the swap originated |
| `destinationChainId` | `BigInt!` | Resolved EVM chain ID of the swap target/recipient (mapped from the Hyperlane domain via domainToChainId) |
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
| `destinationChainId` | `BigInt!` | Resolved EVM chain ID the bridge transaction is destined for (mapped from the Hyperlane domain via domainToChainId) |
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

Keyed by the Hyperlane messageId, which is globally unique (keccak256 of the packed message, including origin domain and the origin Mailbox's nonce), so the ProcessId consumer resolves it with a primary-key read.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {messageId} |
| `chainId` | `Int!` | Chain ID where the message was dispatched (origin chain) |
| `transactionHash` | `String!` | Transaction hash of the dispatch transaction |
| `messageId` | `String!` | Unique message ID identifying the cross-chain message in Hyperlane |

### ProcessId_event

Keyed by the Hyperlane messageId: a Mailbox delivers a message at most once.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {messageId} |
| `chainId` | `Int!` | Chain ID where the message was processed (destination chain) |
| `transactionHash` | `String!` | Transaction hash of the process transaction |
| `messageId` | `String!` | Unique message ID identifying the cross-chain message in Hyperlane (matches DispatchId messageId) |

### TxDispatchIdRegistry

Per-transaction registry of the messageIds dispatched in a tx, so the CrossChainSwap / ProcessId consumers find a source tx's DispatchId_event rows with primary-key reads instead of DispatchId_event.getWhere({ transactionHash }). Append-only: consumers PK-get each DispatchId_event and skip consumed (deleted) ones; the row is deleted once every listed message is consumed.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {transactionHash} |
| `messageIds` | `[String!]!` | DispatchId_event ids (= messageIds) dispatched in this tx, in processing order |

### TxOUSDTSwapRegistry

The first oUSDT swap recorded in a transaction, so the SuperSwap stitching resolves "the oUSDT swap of tx X" with a primary-key read instead of OUSDTSwaps.getWhere({ transactionHash })[0]. Written only when absent, so it holds the first swap in processing order (the row getWhere returned first).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {transactionHash} |
| `swapId` | `String!` | OUSDTSwaps id of the first oUSDT swap recorded in this tx |
| `tokenInPool` | `String!` | Copy of OUSDTSwaps.tokenInPool |
| `tokenOutPool` | `String!` | Copy of OUSDTSwaps.tokenOutPool |
| `amountIn` | `BigInt!` | Copy of OUSDTSwaps.amountIn |
| `amountOut` | `BigInt!` | Copy of OUSDTSwaps.amountOut |

## Aero gauges, staking & emissions

Aero (MetaDEX) gauges on every Aero chain: gauge state, the LeafVoter's emission ledger, rewards managers, and append-only stake / emissions / redemption / rewards rows (ADR 0006). Staked liquidity itself is on Pool / UserStatsPerPool / NonFungiblePosition.

### AeroGauge

One Aero gauge (CL or V2) on one chain. Created when the gauge factory emits GaugeCreated, completed by GaugeManager.GaugeCreated (rewards manager, module, creator) and the LeafVoter's GaugeRegistered / GaugeActivated. The gauge's pool gets Pool.gaugeAddress, so staking flows through the shared Pool / UserStatsPerPool / NonFungiblePosition staking fields. Emission counters mirror the LeafVoter's per-gauge state (`gaugeStates(gauge)`): totalEmissionsCredited = ceiling, totalEmissionsMinted = claimed, totalEmissionsForfeited = surplus. credited - minted - forfeited is what the gauge can still pay out.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{gaugeAddress} (AeroGaugeId) |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `gaugeAddress` | `String!` | gauge contract _(indexed)_ |
| `pool_id` | `String!` | Pool id ({chainId}-{poolAddress}) of the gauge's target; the Pool row exists when the target is an indexed Aero pool _(indexed)_ |
| `poolAddress` | `String!` | the gauge's target (pool) address _(indexed)_ |
| `isCL` | `Boolean!` | true when created by the CL gauge factory (positions are NFPM NFTs), false for V2 gauges (LP tokens) |
| `isPool` | `Boolean!` | gauge factory's isPool flag (false for a gauge on a non-pool staking token) |
| `gaugeFactory` | `String!` | gauge factory that deployed the gauge _(indexed)_ |
| `votingRewardsManager` | `String` | VotingRewardsManager (fees and incentives for allocators); set by GaugeManager.GaugeCreated _(indexed)_ |
| `creationModule` | `String` | GaugeManager module that requested the gauge |
| `creator` | `String` | informational creator the module reported |
| `rewardToken` | `String!` | token the gauge's LPs receive (AERO on Base, xAERO elsewhere) |
| `createdBlockNumber` | `BigInt!` | block of the factory GaugeCreated |
| `createdTimestamp` | `Timestamp!` | block time of the factory GaugeCreated |
| `createdTransactionHash` | `String!` | creation transaction |
| `isRegistered` | `Boolean!` | LeafVoter.GaugeRegistered seen (the LeafVoter settles and pays it) |
| `isActivated` | `Boolean!` | LeafVoter.GaugeActivated seen: allocations route to it (before activation they park on the zero gauge and earn nothing) |
| `activatedTimestamp` | `Timestamp` | block time of activation |
| `emissionCap` | `BigInt` | Per-second emission cap in reward-token wei (EmissionCapSet, refreshed from every GaugeCapSettled). Null until the first EmissionCapSet / GaugeCapSettled: the factory's default cap applies, which is never 0. 0 = deactivated: the gauge earns nothing, allocations to it park idle, its accrual goes to surplus and its fees are not collected. Aero gauges have no other kill / deactivate mechanism. |
| `emissionCapUpdatedTimestamp` | `Timestamp` | block time of the last cap change |
| `minStakeBlocks` | `BigInt` | per-gauge minimum stake (blocks) override (MinStakeBlocksSet); null = the factory's AeroGaugeFactory.minStakeBlocks |
| `referral` | `String` | referral that receives `referralShare` of every LP claim (ReferralConfigSet); null when none |
| `referralShare` | `BigInt` | referral share in pips (1e6 = 100%); null when none |
| `lastGaugeWeight` | `BigInt!` | voting power (decayed sAERO weight, 18 decimals) on the gauge at its last LeafVoter settlement (GaugeCapSettled.gaugeWeight) |
| `lastSettlementTimestamp` | `Timestamp` | block time of the last GaugeCapSettled |
| `totalAllocated` | `BigInt!` | sum of sAERO allocations booked on this gauge by this chain's LeafVoter, in AERO (undecayed nominal amounts; phase 3, see AeroLeafAllocation) |
| `totalEmissionsCredited` | `BigInt!` | sum of GaugeCapSettled.effectiveShare: emissions the LeafVoter credited to the gauge (= gaugeStates.ceiling) |
| `totalCapSurplus` | `BigInt!` | sum of GaugeCapSettled.surplusDelta: accrual above the cap, sent to the chain surplus instead of the gauge |
| `totalEmissionsForfeited` | `BigInt!` | sum of LeafVoter.EmissionsForfeited: credited emissions the gauge returned (accrued while no staked liquidity was in range, early-withdraw penalties) (= gaugeStates.surplus) |
| `totalEmissionsMinted` | `BigInt!` | sum of LeafVoter.EmissionsMinted: emissions minted on claim (= gaugeStates.claimed); equals LP claims + deferred claims + referral claims |
| `totalEmissionsMintedUSD` | `BigInt!` | USD (1e18) of totalEmissionsMinted at each mint's block |
| `totalEmissionsClaimed` | `BigInt!` | LP claims paid at once (EmissionsClaimed) |
| `totalDeferredEmissionsClaimed` | `BigInt!` | earlier deferred LP emissions paid out (DeferredEmissionsClaimed) |
| `totalEmissionsDeferred` | `BigInt!` | LP emissions stored because the mint failed during a withdrawal (EmissionsDeferred) |
| `totalReferralEmissionsDeferred` | `BigInt!` | referral cut stored for the referral (ReferralEmissionsDeferred) |
| `totalReferralEmissionsClaimed` | `BigInt!` | referral emissions paid out (ReferralEmissionsClaimed) |
| `totalEarlyWithdrawPenalty` | `BigInt!` | emissions forfeited by LPs who claimed or withdrew inside the minimum stake window (EarlyWithdrawPenalty); part of totalEmissionsForfeited |
| `numberOfClaims` | `BigInt!` | EmissionsClaimed events |
| `numberOfDeposits` | `BigInt!` | Deposit events |
| `numberOfWithdrawals` | `BigInt!` | Withdraw and EmergencyWithdraw events |
| `totalFeesClaimed0` | `BigInt!` | staked-liquidity pool fees (token0, raw units) the gauge sent to its VotingRewardsManager (gauge ClaimFees) |
| `totalFeesClaimed1` | `BigInt!` | as totalFeesClaimed0, token1 |
| `totalFeesClaimedUSD` | `BigInt!` | USD (1e18) of totalFeesClaimed0/1 at each claim's block (trusted prices only) |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |
| `lastSnapshotTimestamp` | `Timestamp` | epoch of the last AeroGaugeSnapshot; null = never snapshotted |

### AeroGaugeFactory

Configuration of one Aero gauge factory (CL or V2) on one chain, from its own events. The default cap is not emitted at deployment, so defaultCap is null until a DefaultCapSet.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{factoryAddress} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `factoryAddress` | `String!` | gauge factory |
| `isCL` | `Boolean!` | CL gauge factory (true) or V2 gauge factory (false) |
| `defaultCap` | `BigInt` | per-second cap new gauges start with (DefaultCapSet); null = never emitted (set at deployment) |
| `operatorMinCap` | `BigInt` | lowest cap the cap operator may set (OperatorCapRangeSet) |
| `operatorMaxCap` | `BigInt` | highest cap the cap operator may set (OperatorCapRangeSet) |
| `minStakeBlocks` | `BigInt` | default minimum stake in blocks before a claim or withdrawal is penalty-free (PenaltyConfigSet) |
| `penaltyRate` | `BigInt` | early-withdraw penalty in pips (1e6 = 100%) of the accrued emissions (PenaltyConfigSet); 0 = no penalty |
| `maxShareCap` | `BigInt` | ceiling on per-gauge referral shares, pips (MaxShareCapSet) |
| `emergencyWithdrawEnabled` | `Boolean!` | EmergencyWithdrawEnabledSet; while true LPs can exit without touching the LeafVoter (losing unsettled emissions) |
| `numberOfGauges` | `Int!` | gauges this factory created |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |

### AeroLeafVoterState

The Aero LeafVoter of one chain (same address on every chain, Base included): its configuration and chain-level emission totals. Phase 3 adds the allocation fields.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId} |
| `chainId` | `Int!` | chain id |
| `leafVoter` | `String!` | LeafVoter address |
| `rewardToken` | `String!` | token claims pay (AERO on Base, xAERO elsewhere) |
| `chainStatus` | `Int` | LeafVoter ChainStatusSet: 1 Active, 2 Paused, 3 Suspended, 4 Sunset; null = never set (Active since construction) |
| `totalEmissionsCredited` | `BigInt!` | sum of GaugeCapSettled.effectiveShare over real gauges |
| `totalCapSurplus` | `BigInt!` | sum of GaugeCapSettled.surplusDelta, the zero gauge (idle allocations) included |
| `totalIdleSurplus` | `BigInt!` | the part of totalCapSurplus settled on the zero gauge: emissions of allocations parked idle or on unroutable gauges |
| `totalEmissionsForfeited` | `BigInt!` | sum of EmissionsForfeited (gauges) |
| `totalEmissionsMinted` | `BigInt!` | sum of EmissionsMinted: receipt tokens minted on claims (on Base redeemed to AERO in the same transaction) |
| `totalEmissionsMintedUSD` | `BigInt!` | USD (1e18) of totalEmissionsMinted at each mint |
| `totalRedeemed` | `BigInt!` | sum of Redeemed: receipt tokens burned to redeem AERO on Base |
| `numberOfRedemptions` | `BigInt!` | Redeemed events |
| `receiptTokenSupply` | `BigInt!` | totalEmissionsMinted - totalRedeemed: xAERO outstanding (on Base: xAERO whose redemption the RootEmissionsHandler deferred) |
| `emissionsPerVP` | `BigInt` | emissions per unit of voting power, 1e18-scaled, as of the last ChainAllocated / GaugesAllocated (0 while Suspended or Sunset) |
| `totalChainAllocation` | `BigInt!` | sum of AeroLeafTokenState.chainAllocation: sAERO budget sent to this chain |
| `totalBookedAllocation` | `BigInt!` | sum of booked gauge allocations (= sum of AeroGauge.totalAllocated); the rest of totalChainAllocation is idle |
| `allocationCooldown` | `BigInt` | AllocationCooldownSet (seconds); null = deployment value (169,200 s, 47 hours, in the constructor) |
| `maxGauges` | `BigInt` | MaxGaugesSet; null = deployment value (20) |
| `minIncentiveDuration` | `BigInt` | MinIncentiveDurationSet (seconds); null = deployment value (172,800 s) |
| `localVotingEnabled` | `Boolean` | LocalVotingEnabledSet; null = deployment value (false) |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |
| `lastSnapshotTimestamp` | `Timestamp` | epoch of the last AeroLeafVoterStateSnapshot |

### AeroVotingRewardsManager

The VotingRewardsManager of one Aero gauge: the pool fees its gauge collects from staked liquidity, the incentive programs funded for allocators, and what sAERO allocators claim.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{votingRewardsManagerAddress} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `address` | `String!` | VotingRewardsManager _(indexed)_ |
| `gaugeAddress` | `String!` | its gauge _(indexed)_ |
| `poolAddress` | `String!` | the gauge's pool _(indexed)_ |
| `totalFeesCollectedUSD` | `BigInt!` | USD (1e18) of FeesCollected (pool fees pulled from the gauge), trusted prices at each block |
| `numberOfFeeCollections` | `BigInt!` | FeesCollected events (one per token) |
| `totalFeesClaimedUSD` | `BigInt!` | USD (1e18) of fees allocators claimed (ClaimFees, per token), trusted prices at each block |
| `numberOfFeeClaims` | `BigInt!` | ClaimFees events |
| `totalIncentivesFundedUSD` | `BigInt!` | USD (1e18) of incentive programs funded (IncentiveCreated), trusted prices at creation |
| `numberOfIncentivePrograms` | `BigInt!` | IncentiveCreated events |
| `totalIncentivesClaimedUSD` | `BigInt!` | USD (1e18) of incentives allocators claimed (ClaimIncentives), trusted prices at each block |
| `numberOfIncentiveClaims` | `BigInt!` | ClaimIncentives events |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |

### AeroIncentiveProgram

An incentive program funded on a gauge's VotingRewardsManager, streamed to its allocators.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{votingRewardsManager}-{programId} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `votingRewardsManager` | `String!` | rewards manager _(indexed)_ |
| `gaugeAddress` | `String!` | its gauge _(indexed)_ |
| `poolAddress` | `String!` | the gauge's pool |
| `programId` | `BigInt!` | program id within the manager |
| `token` | `String!` | incentive token _(indexed)_ |
| `creator` | `String!` | funder _(indexed)_ |
| `amount` | `BigInt!` | raw amount funded |
| `amountUSD` | `BigInt!` | USD (1e18) at creation (trusted prices only) |
| `start` | `Timestamp!` | stream start |
| `end` | `Timestamp!` | stream end (start + duration) |
| `totalClaimed` | `BigInt!` | raw amount claimed by allocators (ClaimIncentives) |
| `totalSwept` | `BigInt!` | raw unclaimable remainder returned to the creator (IncentiveSwept) |
| `createdTimestamp` | `Timestamp!` | block time of IncentiveCreated |
| `transactionHash` | `String!` | funding transaction |

### AeroGaugeSnapshot

Hourly snapshot of AeroGauge (written at the first change in each hour, after the change), for emissions, weight and cap time series. ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{gaugeAddress}-{epochMs} |
| `chainId` | `Int!` | chain id |
| `gaugeAddress` | `String!` | gauge _(indexed)_ |
| `poolAddress` | `String!` | the gauge's pool _(indexed)_ |
| `isCL` | `Boolean!` | CL or V2 gauge |
| `timestamp` | `Timestamp!` | snapshot epoch (hour) _(indexed)_ |
| `isActivated` | `Boolean!` | see AeroGauge |
| `emissionCap` | `BigInt` | see AeroGauge |
| `lastGaugeWeight` | `BigInt!` | see AeroGauge |
| `totalAllocated` | `BigInt!` | see AeroGauge |
| `totalEmissionsCredited` | `BigInt!` | see AeroGauge |
| `totalCapSurplus` | `BigInt!` | see AeroGauge |
| `totalEmissionsForfeited` | `BigInt!` | see AeroGauge |
| `totalEmissionsMinted` | `BigInt!` | see AeroGauge |
| `totalEmissionsMintedUSD` | `BigInt!` | see AeroGauge |
| `totalEarlyWithdrawPenalty` | `BigInt!` | see AeroGauge |
| `totalFeesClaimed0` | `BigInt!` | see AeroGauge |
| `totalFeesClaimed1` | `BigInt!` | see AeroGauge |
| `totalFeesClaimedUSD` | `BigInt!` | see AeroGauge |

### AeroLeafVoterStateSnapshot

Hourly snapshot of AeroLeafVoterState (chain-level emission totals). ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{epochMs} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `timestamp` | `Timestamp!` | snapshot epoch (hour) _(indexed)_ |
| `totalEmissionsCredited` | `BigInt!` | see AeroLeafVoterState |
| `totalCapSurplus` | `BigInt!` | see AeroLeafVoterState |
| `totalIdleSurplus` | `BigInt!` | see AeroLeafVoterState |
| `totalEmissionsForfeited` | `BigInt!` | see AeroLeafVoterState |
| `totalEmissionsMinted` | `BigInt!` | see AeroLeafVoterState |
| `totalEmissionsMintedUSD` | `BigInt!` | see AeroLeafVoterState |
| `totalRedeemed` | `BigInt!` | see AeroLeafVoterState |
| `receiptTokenSupply` | `BigInt!` | see AeroLeafVoterState |
| `emissionsPerVP` | `BigInt` | see AeroLeafVoterState |
| `totalChainAllocation` | `BigInt!` | see AeroLeafVoterState |
| `totalBookedAllocation` | `BigInt!` | see AeroLeafVoterState |

### AeroGaugeStakeEvent

One row per Aero gauge Deposit, Withdraw or EmergencyWithdraw. ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{logIndex} |
| `chainId` | `Int!` | chain id |
| `kind` | `String!` | DEPOSIT \| WITHDRAW \| EMERGENCY_WITHDRAW (values pinned by AERO_STAKE_EVENT_KIND) |
| `gaugeAddress` | `String!` | gauge _(indexed)_ |
| `poolAddress` | `String!` | the gauge's pool _(indexed)_ |
| `isCL` | `Boolean!` | CL (amount = liquidity L, tokenId set) or V2 (amount = LP tokens) |
| `account` | `String!` | staked owner (CL _user / V2 _account) _(indexed)_ |
| `caller` | `String` | transaction-level caller (Deposit / Withdraw _caller); null on EmergencyWithdraw |
| `tokenId` | `BigInt` | CL position NFT; null on V2 gauges |
| `amount` | `BigInt!` | liquidity (CL) or LP tokens (V2) staked or unstaked |
| `blockNumber` | `BigInt!` | block number |
| `timestamp` | `Timestamp!` | block time _(indexed)_ |
| `transactionHash` | `String!` | transaction |

### AeroEmissionsEvent

One row per Aero gauge emissions event per LP: claims, deferrals, referral legs, early-withdraw penalties. Mints, forfeits and settlements are per gauge on AeroGauge / AeroGaugeSnapshot. ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{logIndex} |
| `chainId` | `Int!` | chain id |
| `kind` | `String!` | CLAIMED (EmissionsClaimed: paid to recipient), DEFERRED (EmissionsDeferred: stored after a failed mint), DEFERRED_CLAIMED (DeferredEmissionsClaimed), REFERRAL_DEFERRED (ReferralEmissionsDeferred: the referral's cut of an LP claim), REFERRAL_CLAIMED (ReferralEmissionsClaimed), EARLY_WITHDRAW_PENALTY (EarlyWithdrawPenalty: forfeited by the LP). Pinned by AERO_EMISSIONS_EVENT_KIND. |
| `gaugeAddress` | `String!` | gauge _(indexed)_ |
| `poolAddress` | `String!` | the gauge's pool _(indexed)_ |
| `account` | `String!` | LP staker (REFERRAL_DEFERRED: the LP whose claim paid the referral; REFERRAL_CLAIMED: the referral) _(indexed)_ |
| `recipient` | `String` | recipient of a paid amount (CLAIMED, DEFERRED_CLAIMED, REFERRAL_CLAIMED) |
| `referral` | `String` | referral address (REFERRAL_DEFERRED) |
| `tokenId` | `BigInt` | CL position NFT (per-position CL events); null otherwise |
| `amount` | `BigInt!` | reward-token amount (18 decimals) |
| `amountUSD` | `BigInt!` | USD (1e18) at the reward token's stored price |
| `rewardToken` | `String!` | AERO (Base) or xAERO |
| `blockNumber` | `BigInt!` | block number |
| `timestamp` | `Timestamp!` | block time _(indexed)_ |
| `transactionHash` | `String!` | transaction |

### AeroRedemptionEvent

One row per redemption step. Phase 2: INITIATED (LeafVoter.Redeemed: xAERO burned on a leaf chain for AERO on Base). On Base the RootEmissionsHandler redeems every claim automatically; those internal redemptions are counted on AeroLeafVoterState but get no row. Phase 3 adds the root side. ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{logIndex} |
| `chainId` | `Int!` | chain the event was emitted on |
| `kind` | `String!` | INITIATED \| PROCESSED \| DEFERRED \| BUFFER_DRAWN \| DONATED \| SURPLUS_SPENT (pinned by AERO_REDEMPTION_EVENT_KIND) |
| `sourceChainId` | `Int!` | chain whose receipt tokens are redeemed (INITIATED: the emitting chain; root kinds: the event's chain id) |
| `redeemer` | `String` | address whose xAERO was burned (INITIATED) |
| `recipient` | `String` | AERO recipient on Base _(indexed)_ |
| `amount` | `BigInt!` | 18-decimal amount (xAERO burned / AERO minted or paid) |
| `surplusReported` | `BigInt` | PROCESSED: the chain's reported surplus high-water mark after the redeem |
| `blockNumber` | `BigInt!` | block number |
| `timestamp` | `Timestamp!` | block time _(indexed)_ |
| `transactionHash` | `String!` | transaction |

### AeroVotingRewardsEvent

One row per VotingRewardsManager flow. Phase 2: FEES_COLLECTED (pool fees of staked liquidity pulled from the gauge into the manager, per token). Phase 3 adds the allocator side. ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{logIndex} |
| `chainId` | `Int!` | chain id |
| `kind` | `String!` | FEES_COLLECTED \| FEES_CLAIMED \| INCENTIVE_CREATED \| INCENTIVE_CLAIMED \| INCENTIVE_SWEPT (pinned by AERO_VOTING_REWARDS_EVENT_KIND) |
| `votingRewardsManager` | `String!` | VotingRewardsManager _(indexed)_ |
| `gaugeAddress` | `String!` | its gauge _(indexed)_ |
| `poolAddress` | `String!` | the gauge's pool _(indexed)_ |
| `tokenId` | `BigInt` | sAERO position (claims) |
| `recipient` | `String` | claim recipient (claims) _(indexed)_ |
| `token` | `String` | token moved; null on INCENTIVE_CLAIMED / INCENTIVE_SWEPT rows whose program is unknown |
| `programId` | `BigInt` | incentive program (INCENTIVE_*) |
| `amount` | `BigInt!` | raw token amount |
| `amountUSD` | `BigInt!` | USD (1e18) at the token's stored price on this chain; 0 when the token is untrusted or not indexed |
| `blockNumber` | `BigInt!` | block number |
| `timestamp` | `Timestamp!` | block time _(indexed)_ |
| `transactionHash` | `String!` | transaction |

## Aero governance

sAERO positions (VotingEscrow, Base), the root Voter's per-chain allocation ledger (Base) and each LeafVoter's booked gauge allocations, the Minter and the legacy-to-Aero migration (ADR 0006).

### SAeroPosition

One sAERO position (VotingEscrow NFT) on Base. tokenId 0 is the protocol accumulator (fees the VoterPaymentsModule charges, permanently staked, burned through Burn); it has no NFT and no owner.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId} (SAeroPositionId) |
| `chainId` | `Int!` | chain id (Base) |
| `tokenId` | `BigInt!` | VotingEscrow tokenId _(indexed)_ |
| `owner` | `String!` | current NFT owner (zero address for the accumulator) _(indexed)_ |
| `amount` | `BigInt!` | AERO staked (18 decimals) |
| `stakeEnd` | `BigInt!` | unlock time (unix seconds, week-aligned); 0 for a permanent stake or an empty position |
| `isPermanent` | `Boolean!` | permanent stake: no decay, voting power = amount |
| `createdVia` | `String!` | MINT_PENDING (NFT minted, stake not seen yet), CREATE_STAKE (createStake), REBALANCE (minted by a VoterPaymentsModule split / merge), ACCUMULATOR (tokenId 0) |
| `totalDeposited` | `BigInt!` | AERO deposited by createStake / reviveStake / increaseStakeAmount |
| `totalWithdrawn` | `BigInt!` | AERO withdrawn after expiry (Withdraw) |
| `totalRebalancedIn` | `BigInt!` | AERO moved in by VotingEscrow.Rebalance (VoterPaymentsModule deposits, splits, merges) |
| `totalRebalancedOut` | `BigInt!` | AERO moved out by VotingEscrow.Rebalance |
| `createdTimestamp` | `Timestamp!` | block time of the mint (or first touch for the accumulator) |
| `createdTransactionHash` | `String!` | mint transaction |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |

### SAeroEscrowState

The VotingEscrow (sAERO) on Base: supply and position counts.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId} |
| `chainId` | `Int!` | chain id (Base) |
| `supply` | `BigInt!` | total AERO staked (Supply event; = sum of SAeroPosition.amount) |
| `permanentStakeBalance` | `BigInt!` | AERO in permanent positions (accumulator included), tracked from position changes |
| `accumulatorAmount` | `BigInt!` | AERO held by the tokenId-0 protocol accumulator |
| `totalBurned` | `BigInt!` | accumulator AERO burned (Burn) |
| `numberOfPositions` | `Int!` | sAERO NFTs minted |
| `lastTokenId` | `BigInt!` | highest tokenId minted |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |
| `lastSnapshotTimestamp` | `Timestamp` | epoch of the last SAeroEscrowStateSnapshot |

### SAeroEscrowStateSnapshot

Hourly snapshot of SAeroEscrowState. ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{epochMs} |
| `chainId` | `Int!` | chain id |
| `timestamp` | `Timestamp!` | snapshot epoch (hour) _(indexed)_ |
| `supply` | `BigInt!` | see SAeroEscrowState |
| `permanentStakeBalance` | `BigInt!` | see SAeroEscrowState |
| `accumulatorAmount` | `BigInt!` | see SAeroEscrowState |
| `numberOfPositions` | `Int!` | see SAeroEscrowState |

### SAeroPositionEvent

One row per change to an sAERO position. ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{logIndex}[-{leg}] (a Rebalance writes one row per leg) |
| `chainId` | `Int!` | chain id (Base) |
| `kind` | `String!` | MINT (NFT minted), TRANSFER (owner change), CREATE_STAKE / INCREASE_AMOUNT / INCREASE_PERIOD / REVIVE_STAKE (Deposit by type), WITHDRAW, UPGRADE_PERMANENT, DOWNGRADE_PERMANENT, REBALANCE_OUT / REBALANCE_IN (one row per VotingEscrow.Rebalance leg), BURN (accumulator). Pinned by SAERO_EVENT_KIND. |
| `tokenId` | `BigInt!` | position _(indexed)_ |
| `owner` | `String` | owner after the change _(indexed)_ |
| `counterparty` | `String` | TRANSFER: previous owner; Deposit: provider |
| `amount` | `BigInt!` | AERO moved by this change (0 for owner, period and mode changes) |
| `amountAfter` | `BigInt!` | position amount after the change |
| `stakeEndAfter` | `BigInt!` | unlock time after the change (0 = permanent or empty) |
| `isPermanentAfter` | `Boolean!` | permanent after the change |
| `supplyAfter` | `BigInt` | VotingEscrow supply after the change (the transaction's Supply event; null when the change emits none) |
| `blockNumber` | `BigInt!` | block number |
| `timestamp` | `Timestamp!` | block time _(indexed)_ |
| `transactionHash` | `String!` | transaction |

### AeroRootAllocation

Root Voter (Base): voting power a position has booked on one chain. targetChainId 0 is CHAIN0, the idle pool new stake parks on and every allocation draws from; ChainsAllocated moves power from CHAIN0 to a chain, a confirmed leaf deallocation moves it back. Mirrors Voter.allocationChainAmounts.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId}-{targetChainId} |
| `chainId` | `Int!` | chain of the root Voter (Base) |
| `tokenId` | `BigInt!` | sAERO position _(indexed)_ |
| `targetChainId` | `Int!` | chain the power is booked on; 0 = CHAIN0 (idle, earns nothing) _(indexed)_ |
| `amount` | `BigInt!` | AERO booked (undecayed) |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |

### AeroRootGaugeVote

Root Voter (Base): the gauge split a position last dispatched to one chain (GaugesAllocated on the root Voter). Requested, not applied: the leaf may reject or redirect parts of it.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId}-{targetChainId} |
| `chainId` | `Int!` | chain of the root Voter (Base) |
| `tokenId` | `BigInt!` | sAERO position _(indexed)_ |
| `targetChainId` | `Int!` | chain the split was dispatched to _(indexed)_ |
| `gauges` | `[String!]!` | gauge addresses (the zero address = park idle; the dealloc sentinel = return to CHAIN0) |
| `amounts` | `[BigInt!]!` | AERO per gauge, parallel to gauges |
| `lastDispatchedTimestamp` | `Timestamp!` | block time of the dispatch |
| `transactionHash` | `String!` | dispatch transaction |

### AeroRootChainState

Root Voter (Base): per-chain ledger. targetChainId 0 is CHAIN0 (idle power; also counts the accumulator power burned through Burned).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{targetChainId} |
| `chainId` | `Int!` | chain of the root Voter (Base) |
| `targetChainId` | `Int!` | chain (0 = CHAIN0) _(indexed)_ |
| `isRegistered` | `Boolean!` | ChainRegistered seen (chains registered at deployment emit nothing and are marked on first use) |
| `status` | `Int` | ChainStatusSet: 1 Active, 2 Paused, 3 Suspended, 4 Sunset; null = never set |
| `emergencyDeallocationAllowed` | `Boolean!` | EmergencyDeallocationAllowedSet |
| `totalAllocated` | `BigInt!` | AERO booked on the chain over all positions (sum of AeroRootAllocation.amount) |
| `totalRedeemed` | `BigInt!` | AERO paid out for the chain's redemptions (RedeemProcessed) |
| `numberOfRedemptions` | `BigInt!` | RedeemProcessed events |
| `reportedSurplus` | `BigInt!` | surplus high-water mark the chain reported (latest RedeemProcessed) |
| `totalDonated` | `BigInt!` | AERO donated into the chain's redeem buffer (Donated) |
| `totalBufferDrawn` | `BigInt!` | buffer AERO paid out past the chain's ceiling (BufferDrawn) |
| `totalSurplusSpent` | `BigInt!` | surplus governance minted (SurplusSpent) |
| `totalBurned` | `BigInt!` | CHAIN0 only: accumulator power burned (Burned) |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |

### AeroLeafTokenState

LeafVoter (every chain): a position's state on this chain. chainAllocation is the budget the root Voter sent; gauges / allocations are the split this LeafVoter booked (only registered, activated gauges with a non-zero cap, unless the position may vote for zero-cap gauges); the rest of the budget is parked idle on the zero gauge and earns nothing.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `tokenId` | `BigInt!` | sAERO position (lives on Base) _(indexed)_ |
| `chainAllocation` | `BigInt!` | budget on this chain (ChainAllocated; less dealloc returns) |
| `gauges` | `[String!]!` | gauges the budget is booked on |
| `allocations` | `[BigInt!]!` | AERO booked per gauge, parallel to gauges |
| `idleAllocation` | `BigInt!` | chainAllocation minus the booked total: parked on the zero gauge |
| `operator` | `String` | address allowed to re-split locally and claim rewards here (OperatorSet) |
| `canVoteForZeroCapGauges` | `Boolean!` | CanVoteForZeroCapGaugesSet: may book weight on activated gauges with a 0 cap |
| `lastAllocatedTimestamp` | `Timestamp` | block time of the last applied gauge split (the 47-hour cooldown counts from here) |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |

### AeroLeafAllocation

LeafVoter (every chain): a position's booked allocation on one gauge. 0 once removed (the row is kept). Sum over tokenIds = AeroGauge.totalAllocated.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{tokenId}-{gaugeAddress} |
| `chainId` | `Int!` | chain id _(indexed)_ |
| `tokenId` | `BigInt!` | sAERO position _(indexed)_ |
| `gaugeAddress` | `String!` | gauge _(indexed)_ |
| `poolAddress` | `String` | the gauge's pool (null if the gauge is not indexed) |
| `allocated` | `BigInt!` | AERO booked (undecayed); 0 = no longer allocated |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |

### AeroAllocationEvent

One row per allocation change: root ledger moves (PARKED, CHAIN_ALLOCATED, DEALLOCATION_PROCESSED, EMERGENCY_DEALLOCATED, TOKEN_CLEARED, CHAIN0_REBALANCED, BURNED, GAUGES_DISPATCHED: one row per dispatched gauge) and leaf changes (CHAIN_ALLOCATED, GAUGE_ALLOCATED: one row per listed or removed gauge, DEALLOCATED, EMERGENCY_DEALLOCATION_APPLIED). Pinned by AERO_ALLOCATION_EVENT_KIND. ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{logIndex}[-{leg}] |
| `chainId` | `Int!` | chain the event was emitted on |
| `level` | `String!` | ROOT (root Voter, Base) \| LEAF (LeafVoter) |
| `kind` | `String!` | see above |
| `tokenId` | `BigInt!` | sAERO position (0 for TOKEN0 burns) _(indexed)_ |
| `targetChainId` | `Int` | ROOT: the chain the power moved to or from (0 = CHAIN0); LEAF: the emitting chain |
| `gaugeAddress` | `String` | gauge (GAUGES_DISPATCHED, GAUGE_ALLOCATED) _(indexed)_ |
| `amount` | `BigInt!` | AERO moved or requested (signed for ledger moves: negative = removed) |
| `bookedAmount` | `BigInt` | GAUGE_ALLOCATED: AERO this LeafVoter booked on the gauge after the change |
| `chainAllocationAfter` | `BigInt` | LEAF: the position's budget on the chain after the change |
| `emissionsPerVP` | `BigInt` | LEAF CHAIN_ALLOCATED / GAUGE_ALLOCATED: the LeafVoter's emissions-per-voting-power scalar (1e18-scaled) |
| `blockNumber` | `BigInt!` | block number |
| `timestamp` | `Timestamp!` | block time _(indexed)_ |
| `transactionHash` | `String!` | transaction |

### AeroMinterState

The Minter on Base. It mints AERO only when a redemption is processed (and the team share to the Splitter with it), so totalMinted grows with claims, not with time. Rates are null until their setter emits (the deployment values are constructor arguments).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{minterAddress} |
| `chainId` | `Int!` | chain id (Base) |
| `minter` | `String!` | Minter address |
| `baseRate` | `BigInt` | BaseRateSet: base emission rate (AERO wei per second) |
| `dynamicRate` | `BigInt` | DynamicRateSet: dynamic rate target (raw, clamped to the band on read) |
| `teamRate` | `BigInt` | TeamRateSet: team share in pips |
| `bandFloorPips` | `BigInt` | RateBandSet: maximum downward move from the base rate |
| `bandCeilingPips` | `BigInt` | RateBandSet: maximum upward move from the base rate |
| `maxBaseRateChangePips` | `BigInt` | MaxBaseRateChangePipsSet |
| `baseRateUpdateCooldown` | `BigInt` | BaseRateUpdateCooldownSet (seconds) |
| `operator` | `String` | OperatorSet |
| `fed` | `String` | FEDSet |
| `dynamicRateModule` | `String` | DynamicRateModuleSet |
| `totalMinted` | `BigInt!` | AERO minted to redemption recipients (Minted.amount) |
| `totalSplitterShare` | `BigInt!` | AERO minted to the Splitter (Minted.splitterShare) |
| `numberOfMints` | `BigInt!` | Minted events |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |
| `lastSnapshotTimestamp` | `Timestamp` | epoch of the last AeroMinterSnapshot |

### AeroMinterSnapshot

Hourly snapshot of AeroMinterState (mint totals and rates). ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{minterAddress}-{epochMs} |
| `chainId` | `Int!` | chain id |
| `timestamp` | `Timestamp!` | snapshot epoch (hour) _(indexed)_ |
| `baseRate` | `BigInt` | see AeroMinterState |
| `dynamicRate` | `BigInt` | see AeroMinterState |
| `teamRate` | `BigInt` | see AeroMinterState |
| `totalMinted` | `BigInt!` | see AeroMinterState |
| `totalSplitterShare` | `BigInt!` | see AeroMinterState |
| `numberOfMints` | `BigInt!` | see AeroMinterState |

### AeroMinterEvent

One row per Minter configuration change (rates, band, operator, FED, module). ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{logIndex} |
| `chainId` | `Int!` | chain id |
| `kind` | `String!` | BASE_RATE_SET \| DYNAMIC_RATE_SET \| TEAM_RATE_SET \| RATE_BAND_SET \| MAX_BASE_RATE_CHANGE_PIPS_SET \| BASE_RATE_UPDATE_COOLDOWN_SET \| OPERATOR_SET \| FED_SET \| DYNAMIC_RATE_MODULE_SET |
| `value` | `BigInt` | new numeric value (RATE_BAND_SET: the floor) |
| `value2` | `BigInt` | RATE_BAND_SET: the ceiling |
| `address` | `String` | new address (OPERATOR_SET, FED_SET, DYNAMIC_RATE_MODULE_SET) |
| `blockNumber` | `BigInt!` | block number |
| `timestamp` | `Timestamp!` | block time _(indexed)_ |
| `transactionHash` | `String!` | transaction |

### AeroMigrationTotals

Totals of one migration contract.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{migrationContract} |
| `chainId` | `Int!` | chain id |
| `migrationContract` | `String!` | migration contract |
| `legacyToken` | `String!` | AERO_V1 or VELO (SETTLED totals: VELO) |
| `numberOfVeNFTs` | `BigInt!` | veNFTs migrated (VeNFTMigrated) |
| `veNFTAmountIn` | `BigInt!` | legacy locked amount migrated |
| `veNFTAmountOut` | `BigInt!` | new AERO (as sAERO or liquid) for those veNFTs |
| `numberOfLiquid` | `BigInt!` | liquid migrations (LiquidMigrated) |
| `liquidAmountIn` | `BigInt!` | legacy liquid tokens migrated |
| `liquidAmountOut` | `BigInt!` | new AERO for them |
| `numberOfSettlements` | `BigInt!` | SETTLED (Base entrypoint Migrated) |
| `settledAmount` | `BigInt!` | AERO settled on Base for Optimism migrations |
| `lastUpdatedTimestamp` | `Timestamp!` | block time of the last change |

### AeroMigrationEvent

One row per legacy-to-Aero migration: veAERO / AERO v1 on Base (AerodromeMigration), veVELO / VELO on Optimism (VelodromeMigration) and their settlement on Base (VelodromeMigrationEntrypoint). ClickHouse only.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{logIndex} |
| `chainId` | `Int!` | chain id |
| `migrationContract` | `String!` | migration contract |
| `kind` | `String!` | VENFT (veNFT migrated), LIQUID (liquid tokens migrated), SETTLED (Optimism migration settled on Base) |
| `legacyToken` | `String!` | AERO_V1 (Base) or VELO (Optimism) |
| `depositor` | `String` | VENFT / LIQUID: legacy holder |
| `recipient` | `String!` | receiver of the new AERO or sAERO _(indexed)_ |
| `legacyTokenId` | `BigInt` | VENFT: legacy veNFT id |
| `amountIn` | `BigInt` | VENFT / LIQUID: legacy amount (18 decimals) |
| `amountOut` | `BigInt!` | new AERO (VENFT / LIQUID: converted amount; SETTLED: amount settled on Base) |
| `isPermanent` | `Boolean` | VENFT: the legacy lock was permanent |
| `isLiquid` | `Boolean` | VENFT: settled as liquid AERO (expired lock); SETTLED: liquid settlement |
| `nonce` | `BigInt` | SETTLED: Hyperlane migration nonce |
| `blockNumber` | `BigInt!` | block number |
| `timestamp` | `Timestamp!` | block time _(indexed)_ |
| `transactionHash` | `String!` | transaction |

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
| `rootFactoryAddress` | `String!` | RootCLPoolFactory that emitted RootPoolCreated; only a leaf pool created by the leaf CLFactory at this same address may claim the mapping |
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

### PoolTickMap

Per-tick liquidityNet maps of a CL pool, split off the Pool row: hot pools hold hundreds of entries, which every Pool read and write would otherwise (de)serialise, and envio writes a ClickHouse row per block in which an entity changes. Postgres only; read by CLPool Swap / Mint / Burn, the gauge stake paths and NFPM staked-position changes; written only when a map changes (Mint / Burn / stake / unstake / staked-position liquidity change, never a Swap). Each map is a pair of parallel arrays encoding Uniswap v3's per-tick liquidityNet: sorted ascending by tick, dedup'd, no zero-net entries, same length; (edges[i], nets[i]) is one (tick, net) pair. Two arrays instead of a list of structs because GraphQL lists only allow scalars or named types.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Same as the Pool id: {chainId}-{poolAddress} (PoolId) |
| `tickEdges` | `[BigInt!]!` | All positions (CLPool Mint/Burn). Drives the fee-free swap reserve delta (#803) and the swap-derived fee (src/Aggregators/CLSwapFee.ts). |
| `tickEdgeNets` | `[BigInt!]!` | liquidityNet per tick in tickEdges |
| `stakedTickEdges` | `[BigInt!]!` | Staked positions only (gauge deposit / withdraw, NFPM liquidity changes of staked positions). Drives the staked reserve deltas (#666/#719). |
| `stakedTickEdgeNets` | `[BigInt!]!` | staked liquidityNet per tick in stakedTickEdges |

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

### AeroNFPMMintPool

Aero NFPM position creation, step 1 of 2 (src/EventHandlers/NFPM/AeroNFPMLogic.ts). The Aero NFPM's IncreaseLiquidity carries the tick range but not the pool. A CLPool.Mint on an Aero pool whose owner is the pool's NFPM stores its pool here, keyed by every value the NFPM's IncreaseLiquidity repeats, so IncreaseLiquidity finds the pool by primary key (no scan, no positional guess). Deleted by that IncreaseLiquidity (mints and increases alike).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | {chainId}-{txHash}-{nfpmAddress}-{tickLower}-{tickUpper}-{liquidity}-{amount0}-{amount1} (AeroNFPMMintPoolId) |
| `pools` | `[String!]!` | CL pool address of each matching Mint in the tx, in log order (one entry unless two pools received identical mints) |
| `mintLogIndexes` | `[Int!]!` | log index of each of those Mints (parallel to pools) |

### AeroNFPMPendingMint

Aero NFPM position creation, step 2 of 2: the recipient of NFPM.Transfer(mint), held until the same tx's IncreaseLiquidity creates the NonFungiblePosition (the Transfer has the owner but no range or pool; IncreaseLiquidity has the range but no owner). Deleted on creation.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Same as the position's id: {chainId}-{nfpmAddress}-{tokenId} (NonFungiblePositionId) |
| `owner` | `String!` | recipient of the mint Transfer |
| `transactionHash` | `String!` | mint transaction |

### AeroGaugePendingReferral

A gauge's referral configured inside its factory's createGauge, whose ReferralConfigSet is emitted before the factory's GaugeCreated. The GaugeCreated reads it by primary key and deletes it.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Same as the gauge's id: {chainId}-{gaugeAddress} (AeroGaugeId) |
| `referral` | `String!` | referral address |
| `referralShare` | `BigInt!` | referral share, pips |

### NFPMPositionPendingPrincipal

Principal removed from an NFPM position (NFPM.DecreaseLiquidity amounts) and not yet collected. The NFPM's Collect pays principal plus fees, so Collect minus this is the position's fees. Per position (tokenId), unlike CLPositionPendingPrincipal, which is per pool-level position (pool + owner + range) and therefore shared by every NFPM position with the same range. Used for the Aero NFPM; deleted when fully drained.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Same as the position's id: {chainId}-{nfpmAddress}-{tokenId} (NonFungiblePositionId) |
| `pendingPrincipal0` | `BigInt!` | token0 principal awaiting Collect |
| `pendingPrincipal1` | `BigInt!` | token1 principal awaiting Collect |

### V2SwapFeesInTx

V2 swap fee hand-over. A V2 pool emits Fees(sender, amount0, amount1) for the fee it takes on each input token, before the swap's Sync and Swap in the same transaction. The Fees handler adds the amounts here and the Swap handler reads (by primary key) and deletes them, so a swap's fee USD and effective rate come from the fee actually charged. Deleted by the Swap.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{txHash}-{poolAddress} (V2SwapFeesInTxId) |
| `fee0` | `BigInt!` | raw token0 fee of the pending swap |
| `fee1` | `BigInt!` | raw token1 fee of the pending swap |

### TokenPricingPools

Per-token list of pools the token can be priced through (ADR 0003). A pool is appended at creation (V2 PoolFactory / CL CLFactory PoolCreated) for each side whose counterparty sits in a strictly lower pricing tier, so the lists stay small (only connector-side pools qualify) and pricing is acyclic. Handler-only scratch state: never on Token, never in ClickHouse, hidden from the API.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{address} (TokenId); the same id as the Token it belongs to |
| `pools` | `[String!]!` | Pool ids ({chainId}-{poolAddress}), in creation order |

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
| `timestamp` | `Timestamp!` | block timestamp of the transfer |

### ALM_TotalSupplyLimitUpdated_event

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | `ID!` | Format: {chainId}-{lpWrapperAddress} (ALMLPWrapperId) |
| `lpWrapperAddress` | `String!` | LP Wrapper associated to the event |
| `currentTotalSupplyLPTokens` | `BigInt!` | Current supply of LP tokens for the pool, emitted by the event |
| `transactionHash` | `String!` | Transaction hash of the event |
