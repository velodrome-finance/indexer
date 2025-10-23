import { Voter } from "generated";

import type { Token } from "generated/src/Types.gen";
import {
  findPoolByGaugeAddress,
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import {
  CHAIN_CONSTANTS,
  TokenIdByChain,
  toChecksumAddress,
} from "../../Constants";
import { getTokenDetails } from "../../Effects/Index";
import {
  applyLpDiff,
  buildLpDiffFromDistribute,
  computeVoteDiffsFromVoted,
  computeVoterDistributeValues,
} from "./VoterCommonLogic";

Voter.Voted.handler(async ({ event, context }) => {
  // Load pool data
  const poolAddress = toChecksumAddress(event.params.pool);
  const poolData = await loadPoolData(poolAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    toChecksumAddress(event.params.voter),
    poolAddress,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const { poolVoteDiff, userVoteDiff } = computeVoteDiffsFromVoted({
    userVotingPowerToPool: event.params.weight,
    totalPoolVotingPower: event.params.totalWeight,
    timestampMs: event.block.timestamp * 1000,
  });

  updateLiquidityPoolAggregator(
    poolVoteDiff,
    liquidityPoolAggregator,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );

  await updateUserStatsPerPool(
    userVoteDiff,
    userData,
    new Date(event.block.timestamp * 1000),
    context,
  );
});

// Note:
// These pools factories addresses are hardcoded since we can't check the pool type from the Voter contract
const CLPOOLS_FACTORY_LIST: string[] = [
  "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", // base
  "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F", // optimism
  // TODO: Add CL Pool Factory addresses for other chains
].map((x) => toChecksumAddress(x));

const VAMM_POOL_FACTORY_LIST: string[] = [
  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", // base
  "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a", // optimism
  // TODO: Add VAMM Pool Factory addresses for other chains
].map((x) => toChecksumAddress(x));

Voter.GaugeCreated.contractRegister(({ event, context }) => {
  const pf = toChecksumAddress(event.params.poolFactory);
  if (CLPOOLS_FACTORY_LIST.includes(pf)) {
    context.addCLGauge(event.params.gauge);
  } else if (VAMM_POOL_FACTORY_LIST.includes(pf)) {
    context.addGauge(event.params.gauge);
  }

  context.addFeesVotingReward(event.params.feeVotingReward);
  context.addBribesVotingReward(event.params.bribeVotingReward);
});

Voter.GaugeCreated.handler(async ({ event, context }) => {
  // Update the pool entity with the gauge address
  const poolAddress = toChecksumAddress(event.params.pool);
  const gaugeAddress = toChecksumAddress(event.params.gauge);

  const poolEntity = await context.LiquidityPoolAggregator.get(poolAddress);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  if (poolEntity) {
    const poolUpdateDiff = {
      gaugeAddress: gaugeAddress,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    updateLiquidityPoolAggregator(
      poolUpdateDiff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.block.number,
    );
  }
});

Voter.DistributeReward.handler(async ({ event, context }) => {
  const poolEntity = await findPoolByGaugeAddress(
    event.params.gauge,
    event.chainId,
    context,
  );

  if (!poolEntity) {
    context.log.warn(
      `No pool address found for the gauge address ${event.params.gauge.toString()} on chain ${event.chainId}`,
    );
    return;
  }

  const rewardTokenAddress = CHAIN_CONSTANTS[event.chainId].rewardToken(
    event.block.number,
  );

  const [currentLiquidityPool, rewardToken] = await Promise.all([
    context.LiquidityPoolAggregator.get(poolEntity.id),
    context.Token.get(TokenIdByChain(rewardTokenAddress, event.chainId)),
  ]);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  if (!currentLiquidityPool || !rewardToken) {
    context.log.warn(
      `Missing pool or reward token for gauge ${event.params.gauge.toString()} on chain ${event.chainId}`,
    );
    return;
  }

  const result = await computeVoterDistributeValues({
    rewardToken,
    gaugeAddress: event.params.gauge,
    voterAddress: event.srcAddress,
    amountEmittedRaw: event.params.amount,
    blockNumber: event.block.number,
    chainId: event.chainId,
    context,
  });

  const lpDiff = buildLpDiffFromDistribute(
    result,
    event.params.gauge,
    event.block.timestamp * 1000,
  );

  await applyLpDiff(
    context,
    currentLiquidityPool,
    lpDiff,
    event.block.timestamp * 1000,
    event.block.number,
  );
});

/**
 * Handles the WhitelistToken event for the Voter contract.
 *
 * This handler is triggered when a WhitelistToken event is emitted by the Voter contract.
 * It creates a new Voter_WhitelistToken entity and stores it in the context.
 *
 * The Voter_WhitelistToken entity contains the following fields:
 * - id: A unique identifier for the event, composed of the chain ID, block number, and log index.
 * - whitelister: The address of the entity that performed the whitelisting.
 * - token: The address of the token being whitelisted.
 * - isWhitelisted: A boolean indicating whether the token is whitelisted.
 * - timestamp: The timestamp of the block in which the event was emitted, converted to a Date object.
 * - chainId: The ID of the blockchain network where the event occurred.
 *
 * @param {Object} event - The event object containing details of the WhitelistToken event.
 * @param {Object} context - The context object used to interact with the data store.
 */
Voter.WhitelistToken.handler(async ({ event, context }) => {
  const token = await context.Token.get(
    TokenIdByChain(event.params.token, event.chainId),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  // Update the Token entity in the DB, either by updating the existing one or creating a new one
  if (token) {
    const updatedToken: Token = {
      ...token,
      isWhitelisted: event.params._bool,
    };

    context.Token.set(updatedToken as Token);
    return;
  }

  try {
    const tokenDetails = await context.effect(getTokenDetails, {
      contractAddress: event.params.token,
      chainId: event.chainId,
    });
    const updatedToken: Token = {
      id: TokenIdByChain(event.params.token, event.chainId),
      name: tokenDetails.name,
      symbol: tokenDetails.symbol,
      pricePerUSDNew: 0n,
      address: event.params.token,
      chainId: event.chainId,
      decimals: BigInt(tokenDetails.decimals),
      isWhitelisted: event.params._bool,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };
    context.Token.set(updatedToken);
  } catch (error) {
    context.log.error(
      `Error in whitelist token event fetching token details for ${event.params.token} on chain ${event.chainId}: ${error}`,
    );
  }
});

Voter.GaugeKilled.handler(async ({ event, context }) => {
  // Update the pool entity - Empty string because it was killed
  const poolEntity = await findPoolByGaugeAddress(
    event.params.gauge,
    event.chainId,
    context,
  );
  const poolAddress = poolEntity?.id;

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  if (poolAddress) {
    const poolUpdateDiff = {
      gaugeAddress: "",
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    updateLiquidityPoolAggregator(
      poolUpdateDiff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.block.number,
    );
  }
});
