import type { LiquidityPoolAggregator, Token, handlerContext } from "generated";
import { updateLiquidityPoolAggregator } from "../../Aggregators/LiquidityPoolAggregator";
import {
  getIsAlive,
  getTokenDetails,
  getTokensDeposited,
} from "../../Effects/Index";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { multiplyBase1e18 } from "../../Maths";

export interface VoterCommonResult {
  isAlive: boolean;
  tokensDeposited: bigint;
  normalizedEmissionsAmount: bigint;
  normalizedEmissionsAmountUsd: bigint;
  normalizedVotesDepositedAmountUsd: bigint;
}

export async function computeVoterDistributeValues(params: {
  rewardToken: Token;
  gaugeAddress: string;
  voterAddress: string;
  amountEmittedRaw: bigint; // event.params.amount (reward token units)
  blockNumber: number;
  chainId: number;
  context: handlerContext;
}): Promise<VoterCommonResult> {
  const {
    rewardToken,
    gaugeAddress,
    voterAddress,
    amountEmittedRaw,
    blockNumber,
    chainId,
    context,
  } = params;

  // Gauge liveness
  const isAlive = await context.effect(getIsAlive, {
    voterAddress,
    gaugeAddress,
    blockNumber,
    eventChainId: chainId,
  });

  // Snapshot of total votes deposited (gauge balance of reward token)
  const tokensDeposited = await context.effect(getTokensDeposited, {
    rewardTokenAddress: rewardToken.address,
    gaugeAddress,
    blockNumber,
    eventChainId: chainId,
  });

  // Normalize amounts to 1e18
  const normalizedEmissionsAmount = normalizeTokenAmountTo1e18(
    amountEmittedRaw,
    Number(rewardToken.decimals),
  );

  const normalizedVotesDepositedAmount = normalizeTokenAmountTo1e18(
    BigInt(tokensDeposited.toString()),
    Number(rewardToken.decimals),
  );

  // Warn if no USD price
  if (rewardToken.pricePerUSDNew === 0n) {
    context.log.warn(
      `Reward token with ID ${rewardToken.id.toString()} does not have a USD price yet on chain ${chainId}`,
    );
  }

  // USD conversions
  const normalizedEmissionsAmountUsd = multiplyBase1e18(
    normalizedEmissionsAmount,
    rewardToken.pricePerUSDNew,
  );

  const normalizedVotesDepositedAmountUsd = multiplyBase1e18(
    normalizedVotesDepositedAmount,
    rewardToken.pricePerUSDNew,
  );

  return {
    isAlive,
    tokensDeposited,
    normalizedEmissionsAmount,
    normalizedEmissionsAmountUsd,
    normalizedVotesDepositedAmountUsd,
  };
}

export function computeVoteDiffsFromVoted(params: {
  userVotingPowerToPool: bigint; // event.params.weight
  totalPoolVotingPower: bigint; // event.params.totalWeight
  timestampMs: number;
}) {
  const { userVotingPowerToPool, totalPoolVotingPower, timestampMs } = params;

  const poolVoteDiff = {
    numberOfVotes: 1n,
    currentVotingPower: totalPoolVotingPower,
    lastUpdatedTimestamp: new Date(timestampMs),
  };

  const userVoteDiff = {
    numberOfVotes: 1n,
    currentVotingPower: userVotingPowerToPool,
  };

  return { poolVoteDiff, userVoteDiff } as const;
}

export function buildLpDiffFromDistribute(
  result: VoterCommonResult,
  gaugeAddress: string,
  timestampMs: number,
) {
  return {
    totalVotesDeposited: result.tokensDeposited,
    totalVotesDepositedUSD: result.normalizedVotesDepositedAmountUsd,
    totalEmissions: result.normalizedEmissionsAmount,
    totalEmissionsUSD: result.normalizedEmissionsAmountUsd,
    lastUpdatedTimestamp: new Date(timestampMs),
    gaugeAddress,
    gaugeIsAlive: result.isAlive,
  };
}

export function applyLpDiff(
  context: handlerContext,
  currentLiquidityPool: LiquidityPoolAggregator,
  lpDiff: Partial<LiquidityPoolAggregator>,
  timestampMs: number,
  blockNumber: number,
) {
  return updateLiquidityPoolAggregator(
    lpDiff,
    currentLiquidityPool,
    new Date(timestampMs),
    context,
    blockNumber,
  );
}

export async function updateTokenWhitelist(
  context: handlerContext,
  tokenId: string,
  tokenAddress: string,
  chainId: number,
  isWhitelisted: boolean,
  timestampMs: number,
) {
  const token = await context.Token.get(tokenId);
  if (token) {
    const updated = { ...token, isWhitelisted } as Token;
    context.Token.set(updated);
    return;
  }

  try {
    const details = await context.effect(getTokenDetails, {
      contractAddress: tokenAddress,
      chainId,
    });

    const created: Token = {
      id: tokenId,
      name: details.name,
      symbol: details.symbol,
      pricePerUSDNew: 0n,
      address: tokenAddress,
      chainId,
      decimals: BigInt(details.decimals),
      isWhitelisted,
      lastUpdatedTimestamp: new Date(timestampMs),
    } as unknown as Token;
    context.Token.set(created);
  } catch (error) {
    context.log.error(
      `Error updating token whitelist for ${tokenAddress} on chain ${chainId}: ${error}`,
    );
  }
}
