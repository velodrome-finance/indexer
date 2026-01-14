import type { LiquidityPoolAggregator, Token, handlerContext } from "generated";
import {
  type LiquidityPoolAggregatorDiff,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import { getIsAlive, getTokensDeposited } from "../../Effects/Index";
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

  // Load gauge liveness and tokens deposited in parallel for better performance
  const [isAliveResult, tokensDepositedResult] = await Promise.all([
    context.effect(getIsAlive, {
      voterAddress,
      gaugeAddress,
      blockNumber,
      eventChainId: chainId,
    }),
    context.effect(getTokensDeposited, {
      rewardTokenAddress: rewardToken.address,
      gaugeAddress,
      blockNumber,
      eventChainId: chainId,
    }),
  ]);

  // Handle undefined return values - use defaults if effects failed
  const isAlive = isAliveResult ?? false;
  const tokensDeposited = tokensDepositedResult ?? 0n;

  if (isAliveResult === undefined) {
    context.log.error(
      `Failed to fetch isAlive for gauge ${gaugeAddress} on chain ${chainId}, using default: false`,
    );
  }

  if (tokensDepositedResult === undefined) {
    context.log.error(
      `Failed to fetch tokensDeposited for gauge ${gaugeAddress} on chain ${chainId}, using default: 0n`,
    );
  }

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

export function buildLpDiffFromDistribute(
  result: VoterCommonResult,
  gaugeAddress: string,
  timestampMs: number,
): Partial<LiquidityPoolAggregatorDiff> {
  return {
    totalVotesDeposited: result.tokensDeposited,
    totalVotesDepositedUSD: result.normalizedVotesDepositedAmountUsd,
    incrementalTotalEmissions: result.normalizedEmissionsAmount,
    incrementalTotalEmissionsUSD: result.normalizedEmissionsAmountUsd,
    lastUpdatedTimestamp: new Date(timestampMs),
    gaugeAddress,
    gaugeIsAlive: result.isAlive,
  };
}

export async function applyLpDiff(
  context: handlerContext,
  currentLiquidityPool: LiquidityPoolAggregator,
  lpDiff: Partial<LiquidityPoolAggregatorDiff>,
  timestampMs: number,
  blockNumber: number,
) {
  return await updateLiquidityPoolAggregator(
    lpDiff,
    currentLiquidityPool,
    new Date(timestampMs),
    context,
    blockNumber,
  );
}
