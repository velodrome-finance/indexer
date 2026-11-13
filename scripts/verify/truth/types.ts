/**
 * Ground-truth model of one chain at a pinned block, built only from raw logs
 * (HyperSync) and, where noted, contract state (RPC). Nothing here reads the
 * indexer or imports indexer code.
 */

export type Addr = string; // lowercase 0x-hex

export interface LogRef {
  block: number;
  logIndex: number;
  tx: string;
}

export interface CLPositionKey {
  owner: Addr;
  tickLower: number;
  tickUpper: number;
}

export interface PoolTruth {
  address: Addr;
  kind: "v2" | "cl";
  factory: Addr;
  token0: Addr;
  token1: Addr;
  stable: boolean;
  tickSpacing: number;
  created: LogRef;
  /** Logs per indexer event name (configured events only), from this pool. */
  counts: Map<string, number>;
  swaps: number;
  /** V2: Σ(amountIn + amountOut); CL: Σ|amount|. Raw token units. */
  vol0: bigint;
  vol1: bigint;
  lastLog?: LogRef;
  /** Clock hours (unix seconds / 3600) in which the pool emitted any handled log. */
  activeHours: Set<number>;
  firstLogTs?: number;

  // ---- V2 ----
  fees0: bigint;
  fees1: bigint;
  reserve0: bigint;
  reserve1: bigint;
  lastSync?: LogRef;
  lpSupply: bigint;
  /** Σ Mint / MintWithRecipient / Burn token amounts. */
  mint0: bigint;
  mint1: bigint;
  burn0: bigint;
  burn1: bigint;
  claimStaked0: bigint;
  claimStaked1: bigint;
  claimUnstaked0: bigint;
  claimUnstaked1: bigint;
  /** Fee rate the last sizeable swap paid (Fees.amount / amountIn, rounded to whole bps), with its log. */
  v2EffectiveFee?: { bps: bigint; block: number; tx: string };

  // ---- CL ----
  sqrtPriceX96: bigint;
  tick: number;
  /** liquidity reported by the last Swap event (undefined before the first swap). */
  lastSwapLiquidity?: bigint;
  lastSwap?: LogRef;
  initialized: boolean;
  /** Pool positions keyed `${owner}|${tickLower}|${tickUpper}` -> liquidity. */
  positions: Map<string, bigint>;
  sumMint0: bigint;
  sumMint1: bigint;
  sumBurn0: bigint;
  sumBurn1: bigint;
  /** Σ signed Swap.amount (positive = into the pool). */
  sumSwap0: bigint;
  sumSwap1: bigint;
  sumCollect0: bigint;
  sumCollect1: bigint;
  sumCollectFees0: bigint;
  sumCollectFees1: bigint;
  flashPaid0: bigint;
  flashPaid1: bigint;
  flashes: number;
  /** Collect amounts above the position's burned-but-uncollected principal (fees). */
  collectedFees0: bigint;
  collectedFees1: bigint;
  /** Burned principal not yet collected, per position key. */
  pendingPrincipal: Map<string, [bigint, bigint]>;
  swapFeeFromFallback?: never;
}

export interface UserPoolTruth {
  user: Addr;
  pool: Addr;
  swaps: number;
  vol0: bigint;
  vol1: bigint;
  /** V2 only: Σ Fees amounts in txs sent by the user (raw units). */
  fees0: bigint;
  fees1: bigint;
  /** LP balance from Transfer replay (V2). */
  lpBalance: bigint;
  /** V2 Mint/Burn amounts attributed to the LP that provided / redeemed the LP tokens. */
  added0: bigint;
  added1: bigint;
  removed0: bigint;
  removed1: bigint;
  /** Gauge stake (V2: amount; CL: liquidity of NFTs deposited by the user and still held by the gauge). */
  staked: bigint;
  gaugeDeposits: number;
  gaugeWithdrawals: number;
  gaugeClaims: number;
  gaugeRewardsClaimed: bigint;
  /** ALM wrapper LP balance from Transfer replay. */
  almLp: bigint;
}

export interface GaugeTruth {
  address: Addr;
  pool: Addr;
  kind: "v2" | "cl" | "unregistered";
  poolFactory: Addr;
  feeVotingReward: Addr;
  bribeVotingReward: Addr;
  created: LogRef;
  voter: Addr;
  alive: boolean;
  counts: Map<string, number>;
  deposits: number;
  withdrawals: number;
  claims: number;
  rewardsClaimed: bigint;
  /** V2: Σ deposit - Σ withdraw amounts. CL: Σ liquidityToStake deposited - withdrawn. */
  netStakeFromEvents: bigint;
  /** Σ NotifyReward amounts (emissions that reached this gauge on this chain). */
  notified: bigint;
  notifies: number;
  claimFees0: bigint;
  claimFees1: bigint;
}

export interface VotingRewardTruth {
  address: Addr;
  pool: Addr;
  kind: "fee" | "bribe";
  contract: string;
  claims: number;
  /** reward token -> Σ claimed */
  claimed: Map<Addr, bigint>;
  counts: Map<string, number>;
}

export interface NftTruth {
  nfpm: Addr;
  tokenId: bigint;
  owner: Addr;
  /** Last owner that was not the pool's gauge (the indexer does not move owner on gauge transfers). */
  ownerExGauge: Addr;
  burned: boolean;
  liquidity: bigint;
  mintTx: string;
  mintLogIndex: number;
  mintBlock: number;
  pool?: Addr;
  tickLower?: number;
  tickUpper?: number;
  /** Address that deposited the NFT into a gauge (CLGauge.Deposit user), while staked. */
  stakedBy?: Addr;
  stakedIn?: Addr;
}

export interface WrapperTruth {
  address: Addr;
  contract: string;
  pool: Addr;
  created: LogRef;
  depositLp: bigint;
  withdrawLp: bigint;
  totalSupplyFromTransfers: bigint;
  balances: Map<Addr, bigint>;
  counts: Map<string, number>;
}

export interface ChainTruth {
  chainId: number;
  fromBlock: number;
  /** Inclusive pinned block. */
  pinnedBlock: number;
  pinnedTimestamp: number;
  pools: Map<Addr, PoolTruth>;
  gauges: Map<Addr, GaugeTruth>;
  votingRewards: Map<Addr, VotingRewardTruth>;
  wrappers: Map<Addr, WrapperTruth>;
  /** `${nfpm}|${tokenId}` -> NFT */
  nfts: Map<string, NftTruth>;
  users: Map<string, UserPoolTruth>;
  tokens: Set<Addr>;
  whitelist: Map<Addr, boolean>;
  /** Every WhitelistToken change, in order. */
  whitelistHistory: Map<Addr, { block: number; value: boolean }[]>;
  /** `${contract}.${event}` -> on-chain logs the indexer should have handled (configured events, indexed addresses). */
  eventCounts: Map<string, number>;
  /** `${contract}.${event}` -> logs from addresses the config-derived rules would NOT register (e.g. gauges of unknown pool factories). */
  unregisteredEventCounts: Map<string, number>;
  tickSpacingFees: Map<number, number>;
  v2CustomFees: Map<Addr, bigint>;
  notes: string[];
  stats: { logs: number; seconds: number };
}

/**
 * Key of a user/pool pair in {@link ChainTruth.users}.
 * @param user - User address (lowercase)
 * @param pool - Pool address (lowercase)
 * @returns Map key
 */
export function userKey(user: Addr, pool: Addr): string {
  return `${user}|${pool}`;
}
