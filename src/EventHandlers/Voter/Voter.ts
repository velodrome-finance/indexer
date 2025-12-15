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
import { refreshTokenPrice } from "../../PriceOracle";
import {
  applyLpDiff,
  buildLpDiffFromDistribute,
  computeVoterDistributeValues,
} from "./VoterCommonLogic";

// Leads to a deposit of veNFT
Voter.Voted.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  const poolAddress = toChecksumAddress(event.params.pool);
  const [poolData, userData] = await Promise.all([
    loadPoolData(poolAddress, event.chainId, context),
    loadUserData(
      toChecksumAddress(event.params.voter),
      poolAddress,
      event.chainId,
      context,
      new Date(event.block.timestamp * 1000),
    ),
  ]);

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const poolVoteDiff = {
    veNFTamountStaked: event.params.totalWeight, // it's veNFT token amount!! This is absolute total veNFT staked in pool, substituting directly the previous value
  };

  const userVoteDiff = {
    veNFTamountStaked: event.params.weight, // it's veNFT token amount!! Positive because it's a deposit
  };

  await Promise.all([
    updateLiquidityPoolAggregator(
      poolVoteDiff,
      liquidityPoolAggregator,
      new Date(event.block.timestamp * 1000),
      context,
      event.block.number,
    ),
    updateUserStatsPerPool(
      userVoteDiff,
      userData,
      new Date(event.block.timestamp * 1000),
      context,
    ),
  ]);
});

// The opposite of the Voted event: effectively withdraws veNFT
Voter.Abstained.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  const poolAddress = toChecksumAddress(event.params.pool);
  const [poolData, userData] = await Promise.all([
    loadPoolData(poolAddress, event.chainId, context),
    loadUserData(
      toChecksumAddress(event.params.voter),
      poolAddress,
      event.chainId,
      context,
      new Date(event.block.timestamp * 1000),
    ),
  ]);

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const poolVoteDiff = {
    veNFTamountStaked: event.params.totalWeight, // it's veNFT token amount!! This is absolute total veNFT staked in pool, substituting directly the previous value
  };

  const userVoteDiff = {
    veNFTamountStaked: -event.params.weight, // it's veNFT token amount!! Negative because it's a withdrawal
  };

  await Promise.all([
    updateLiquidityPoolAggregator(
      poolVoteDiff,
      liquidityPoolAggregator,
      new Date(event.block.timestamp * 1000),
      context,
      event.block.number,
    ),
    updateUserStatsPerPool(
      userVoteDiff,
      userData,
      new Date(event.block.timestamp * 1000),
      context,
    ),
  ]);
});

// Note:
// These pools factories addresses are hardcoded since we can't check the pool type from the Voter contract
const CLPOOLS_FACTORY_LIST: string[] = [
  "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", // base
  "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F", // optimism
].map((x) => toChecksumAddress(x));

const VAMM_POOL_FACTORY_LIST: string[] = [
  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", // base
  "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a", // optimism
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

  if (poolEntity) {
    const poolUpdateDiff = {
      gaugeAddress: gaugeAddress,
      feeVotingRewardAddress: event.params.feeVotingReward,
      bribeVotingRewardAddress: event.params.bribeVotingReward,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updateLiquidityPoolAggregator(
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

  if (!currentLiquidityPool || !rewardToken) {
    context.log.warn(
      `Missing pool or reward token for gauge ${event.params.gauge.toString()} on chain ${event.chainId}`,
    );
    return;
  }

  // Refresh reward token price if it's zero (token was just created or price fetch failed previously)
  // Or if more than 1h has passed since last update
  const updatedRewardToken = await refreshTokenPrice(
    rewardToken,
    event.block.number,
    event.block.timestamp,
    event.chainId,
    context,
  );

  context.log.info(`Reward token address: ${rewardToken.address}`);
  context.log.info(
    `Updated reward token price: ${updatedRewardToken.pricePerUSDNew.toString()}`,
  );

  const result = await computeVoterDistributeValues({
    rewardToken: updatedRewardToken,
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

  // Update the Token entity in the DB, either by updating the existing one or creating a new one
  if (token) {
    const updatedToken: Token = {
      ...token,
      isWhitelisted: event.params._bool,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
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
  // Update the pool entity - mark gauge as not alive and clear gauge address
  // Keep voting reward addresses as historical data
  const poolEntity = await findPoolByGaugeAddress(
    event.params.gauge,
    event.chainId,
    context,
  );
  const poolAddress = poolEntity?.id;

  if (poolAddress) {
    const poolUpdateDiff = {
      gaugeIsAlive: false,
      // Keep gaugeAddress, feeVotingRewardAddress and bribeVotingRewardAddress as historical data
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updateLiquidityPoolAggregator(
      poolUpdateDiff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.block.number,
    );
  }
});
