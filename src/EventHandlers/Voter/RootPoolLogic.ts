/**
 * Root-side state of superchain root pools (ADR 0009, step 2).
 *
 * A superchain leaf pool's votes and emissions happen on the root chain
 * (Optimism) against a placeholder "root pool". These helpers record them on
 * the root chain, from root-chain events only: `RootPool` (vote weight,
 * emissions, gauge, leaf chain and pair) and `RootPoolVote` (one veNFT's vote
 * on a root pool). The analytics layer joins a root pool to its leaf pool
 * (`root_leaf_pools`). The cross-chain handlers that write the same numbers
 * onto the leaf Pool keep running until the per-chain flip.
 */
import type { RootPool, Token } from "envio";
import {
  type Address,
  encodePacked,
  getAddress,
  getContractAddress,
  keccak256,
} from "viem";
import {
  CHAIN_CONSTANTS,
  RootGaugeRootPoolId,
  VeNFTId,
  rootPoolMatchingHash,
} from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { getTrustedUSD } from "../../PriceTrust";
import { VoterEventType } from "./VoterCommonLogic";

/** The superchain root chain (Optimism). Base has no root pools. */
export const SUPERCHAIN_ROOT_CHAIN_ID = 10;

/**
 * Implementation the superchain V2 RootPoolFactory
 * (0x31832f2a97Fd20664D76Cc421207669b55CE4BC0) clones for every root pool
 * (`implementation()`, read once on 2026-11-16). With it a root pool's address
 * is CREATE2(factory, keccak256(chainid, token0, token1, stable), EIP-1167
 * clone of this implementation), so the leaf chain can be recovered from the
 * address. Checked on all 58 V2 root pools on Optimism and against 170 leaf
 * LpHelper `root_lp_address` answers (Metal, Mode, Lisk).
 */
export const V2_ROOT_POOL_IMPLEMENTATION =
  "0x10499d88Bd32AF443Fc936F67DE32bE1c8Bb374C";

/** Superchain leaf chains: every chain with a legacy deployment but the roots and Base. */
export const SUPERCHAIN_LEAF_CHAIN_IDS: readonly number[] = Object.keys(
  CHAIN_CONSTANTS,
)
  .map(Number)
  .filter(
    (id) =>
      CHAIN_CONSTANTS[id].legacy !== undefined &&
      id !== SUPERCHAIN_ROOT_CHAIN_ID &&
      id !== 8453,
  )
  .sort((a, b) => a - b);

/**
 * Entity id of a RootPool: `{chainId}-{rootPoolAddress}`.
 *
 * @param chainId - Root chain id
 * @param rootPoolAddress - Root pool address (checksummed)
 * @returns The id
 */
export const RootPoolId = (chainId: number, rootPoolAddress: string) =>
  `${chainId}-${rootPoolAddress}`;

/**
 * Entity id of a RootPoolVote: `{chainId}-{tokenId}-{rootPoolAddress}`.
 *
 * @param chainId - Root chain id
 * @param tokenId - veNFT id
 * @param rootPoolAddress - Root pool address (checksummed)
 * @returns The id
 */
export const RootPoolVoteId = (
  chainId: number,
  tokenId: bigint,
  rootPoolAddress: string,
) => `${chainId}-${tokenId}-${rootPoolAddress}`;

/**
 * The address a V2 RootPoolFactory clone gets for a pair on a leaf chain.
 *
 * @param factory - The RootPoolFactory
 * @param leafChainId - Leaf chain id (the salt's chainid)
 * @param token0 - token0 (sorted, as in RootPoolCreated)
 * @param token1 - token1
 * @param stable - Stable pool
 * @param implementation - The factory's clone implementation
 * @returns The checksummed CREATE2 address
 */
export function predictV2RootPoolAddress(
  factory: string,
  leafChainId: number,
  token0: string,
  token1: string,
  stable: boolean,
  implementation: string = V2_ROOT_POOL_IMPLEMENTATION,
): string {
  const salt = keccak256(
    encodePacked(
      ["uint256", "address", "address", "bool"],
      [
        BigInt(leafChainId),
        getAddress(token0) as Address,
        getAddress(token1) as Address,
        stable,
      ],
    ),
  );
  const bytecode =
    `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3` as const;
  return getContractAddress({
    opcode: "CREATE2",
    from: getAddress(factory) as Address,
    salt,
    bytecode,
  });
}

/**
 * The leaf chain of a V2 root pool, recovered from its address: the one known
 * leaf chain whose CREATE2 salt gives that address.
 *
 * @param factory - The RootPoolFactory that emitted RootPoolCreated
 * @param rootPoolAddress - The root pool from RootPoolCreated
 * @param token0 - token0 from RootPoolCreated
 * @param token1 - token1 from RootPoolCreated
 * @param stable - stable from RootPoolCreated
 * @param candidates - Leaf chains to try
 * @returns The leaf chain id, or undefined when no candidate (or more than one) matches
 */
export function deriveV2RootPoolLeafChain(
  factory: string,
  rootPoolAddress: string,
  token0: string,
  token1: string,
  stable: boolean,
  candidates: readonly number[] = SUPERCHAIN_LEAF_CHAIN_IDS,
): number | undefined {
  const target = getAddress(rootPoolAddress);
  const hits = candidates.filter(
    (c) =>
      predictV2RootPoolAddress(factory, c, token0, token1, stable) === target,
  );
  return hits.length === 1 ? hits[0] : undefined;
}

/** What a root pool is created with: the pair, its factory and its leaf chain. */
export type RootPoolCreation = {
  chainId: number;
  rootPoolAddress: string;
  leafChainId: number | undefined;
  isCL: boolean;
  token0: string;
  token1: string;
  tickSpacing?: bigint;
  isStable?: boolean;
  rootFactoryAddress: string;
  blockNumber: number;
  timestamp: Date;
};

/**
 * Creates the RootPool for a root pool factory's creation event, unless it
 * exists. CL root pools carry the leaf Pool's `rootPoolMatchingHash`.
 *
 * @param c - The creation fields
 * @param context - Handler context
 * @returns Promise that resolves once the RootPool is staged
 */
export async function createRootPool(
  c: RootPoolCreation,
  context: handlerContext,
): Promise<void> {
  const id = RootPoolId(c.chainId, c.rootPoolAddress);
  if (await context.RootPool.get(id)) {
    return;
  }
  context.RootPool.set({
    id,
    rootPoolAddress: c.rootPoolAddress,
    leafChainId: c.leafChainId,
    isCL: c.isCL,
    token0: c.token0,
    token1: c.token1,
    tickSpacing: c.tickSpacing,
    isStable: c.isStable,
    rootFactoryAddress: c.rootFactoryAddress,
    rootPoolMatchingHash:
      c.isCL && c.leafChainId !== undefined && c.tickSpacing !== undefined
        ? rootPoolMatchingHash(c.leafChainId, c.token0, c.token1, c.tickSpacing)
        : undefined,
    gaugeAddress: undefined,
    gaugeIsAlive: false,
    veNFTamountStaked: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    numberOfDistributions: 0n,
    createdBlockNumber: BigInt(c.blockNumber),
    createdTimestamp: c.timestamp,
    lastUpdatedTimestamp: c.timestamp,
  });
}

/**
 * Records a Voted / Abstained on a root pool: the pool's weight becomes the
 * event's `totalWeight` (Voter.weights(pool) after the vote) and the veNFT's
 * RootPoolVote moves by `weight`. A pool without a RootPool (a local pool, or
 * a sink) is left alone.
 *
 * @param chainId - Chain of the Voter event
 * @param poolAddress - `event.params.pool`
 * @param tokenId - `event.params.tokenId`
 * @param weight - `event.params.weight` (this veNFT's change)
 * @param totalWeight - `event.params.totalWeight` (the pool's weight after it)
 * @param eventType - Voted or Abstained
 * @param timestamp - Block time
 * @param context - Handler context
 * @returns Promise resolving to true when the pool is a root pool and was updated
 */
export async function applyRootPoolVote(
  chainId: number,
  poolAddress: string,
  tokenId: bigint,
  weight: bigint,
  totalWeight: bigint,
  eventType: VoterEventType,
  timestamp: Date,
  context: handlerContext,
): Promise<boolean> {
  if (chainId !== SUPERCHAIN_ROOT_CHAIN_ID) {
    return false;
  }
  const voteId = RootPoolVoteId(chainId, tokenId, poolAddress);
  const [rootPool, vote] = await Promise.all([
    getRehydrated(
      context.RootPool,
      "RootPool",
      RootPoolId(chainId, poolAddress),
    ),
    getRehydrated(context.RootPoolVote, "RootPoolVote", voteId),
  ]);
  if (!rootPool) {
    return false;
  }
  const delta = eventType === VoterEventType.VOTED ? weight : -weight;
  context.RootPool.set({
    ...rootPool,
    veNFTamountStaked: totalWeight,
    lastUpdatedTimestamp: timestamp,
  });
  context.RootPoolVote.set({
    id: voteId,
    rootPoolAddress: poolAddress,
    tokenId,
    veNFTStateId: VeNFTId(chainId, tokenId),
    veNFTamountStaked: (vote?.veNFTamountStaked ?? 0n) + delta,
    lastUpdatedTimestamp: timestamp,
  });
  return true;
}

/**
 * Records a DistributeReward to a root gauge on its RootPool: emissions
 * (1e18-normalized) and their USD value at the reward token's stored price.
 * A gauge without a RootGauge_RootPool / RootPool is left alone.
 *
 * @param chainId - Chain of the DistributeReward
 * @param gaugeAddress - `event.params.gauge`
 * @param amount - `event.params.amount` (raw reward-token units)
 * @param rewardToken - The chain's reward token (decimals and price); undefined when not indexed (18 decimals, no USD)
 * @param timestamp - Block time
 * @param context - Handler context
 * @returns Promise resolving to true when the gauge is a root gauge and its RootPool was updated
 */
export async function applyRootPoolDistribution(
  chainId: number,
  gaugeAddress: string,
  amount: bigint,
  rewardToken: Token | undefined,
  timestamp: Date,
  context: handlerContext,
): Promise<boolean> {
  if (chainId !== SUPERCHAIN_ROOT_CHAIN_ID) {
    return false;
  }
  const rootPool = await loadRootPoolByGauge(chainId, gaugeAddress, context);
  if (!rootPool) {
    return false;
  }
  const decimals = rewardToken ? Number(rewardToken.decimals) : 18;
  context.RootPool.set({
    ...rootPool,
    totalEmissions:
      rootPool.totalEmissions + normalizeTokenAmountTo1e18(amount, decimals),
    totalEmissionsUSD:
      rootPool.totalEmissionsUSD + getTrustedUSD(amount, rewardToken, chainId),
    numberOfDistributions: rootPool.numberOfDistributions + 1n,
    lastUpdatedTimestamp: timestamp,
  });
  return true;
}

/**
 * Sets a root pool's gauge (GaugeCreated) or its liveness (GaugeKilled /
 * GaugeRevived).
 *
 * @param chainId - Chain of the Voter event
 * @param poolAddress - The root pool (GaugeCreated) or undefined to find it by gauge
 * @param gaugeAddress - The gauge
 * @param alive - The gauge's liveness after the event
 * @param timestamp - Block time
 * @param context - Handler context
 * @returns Promise resolving to true when a RootPool was updated
 */
export async function setRootPoolGauge(
  chainId: number,
  poolAddress: string | undefined,
  gaugeAddress: string,
  alive: boolean,
  timestamp: Date,
  context: handlerContext,
): Promise<boolean> {
  if (chainId !== SUPERCHAIN_ROOT_CHAIN_ID) {
    return false;
  }
  const rootPool = poolAddress
    ? await getRehydrated(
        context.RootPool,
        "RootPool",
        RootPoolId(chainId, poolAddress),
      )
    : await loadRootPoolByGauge(chainId, gaugeAddress, context);
  if (!rootPool) {
    return false;
  }
  context.RootPool.set({
    ...rootPool,
    gaugeAddress,
    gaugeIsAlive: alive,
    lastUpdatedTimestamp: timestamp,
  });
  return true;
}

/**
 * The RootPool behind a root gauge, through RootGauge_RootPool.
 *
 * @param chainId - Root chain id
 * @param gaugeAddress - Root gauge
 * @param context - Handler context
 * @returns The RootPool, or undefined
 */
export async function loadRootPoolByGauge(
  chainId: number,
  gaugeAddress: string,
  context: handlerContext,
): Promise<RootPool | undefined> {
  const mapping = await context.RootGauge_RootPool.get(
    RootGaugeRootPoolId(chainId, gaugeAddress),
  );
  if (!mapping) {
    return undefined;
  }
  return getRehydrated(
    context.RootPool,
    "RootPool",
    RootPoolId(chainId, mapping.rootPoolAddress),
  );
}
