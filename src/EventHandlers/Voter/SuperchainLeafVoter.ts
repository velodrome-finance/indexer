import { SuperchainLeafVoter } from "generated";

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
  computeVoteDiffsFromVoted,
  computeVoterDistributeValues,
} from "./VoterCommonLogic";

SuperchainLeafVoter.Voted.handler(async ({ event, context }) => {
  // Load pool data
  const poolAddress = toChecksumAddress(event.params.pool);
  const poolData = await loadPoolData(poolAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    toChecksumAddress(event.params.sender),
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
  "0xeAD23f606643E387a073D0EE8718602291ffaAeB", // soneuim
  // TODO: Add CL Pool Factory addresses for other chains (superchain chains)
].map((x) => toChecksumAddress(x));

const VAMM_POOL_FACTORY_LIST: string[] = [
  "0x42e403b73898320f23109708b0ba1Ae85838C445", // soneuim
  // TODO: Add VAMM Pool Factory addresses for other chains (superchain chains)
].map((x) => toChecksumAddress(x));

SuperchainLeafVoter.GaugeCreated.contractRegister(({ event, context }) => {
  const pf = toChecksumAddress(event.params.poolFactory);
  if (CLPOOLS_FACTORY_LIST.includes(pf)) {
    context.addCLGauge(event.params.gauge);
  } else if (VAMM_POOL_FACTORY_LIST.includes(pf)) {
    context.addGauge(event.params.gauge);
  }

  context.addFeesVotingReward(event.params.feeVotingReward);
  context.addBribesVotingReward(event.params.incentiveVotingReward);
});

SuperchainLeafVoter.GaugeCreated.handler(async ({ event, context }) => {
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
      feeVotingRewardAddress: event.params.feeVotingReward,
      bribeVotingRewardAddress: event.params.incentiveVotingReward,
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

SuperchainLeafVoter.DistributeReward.handler(async ({ event, context }) => {
  const poolEntity = await findPoolByGaugeAddress(
    event.params.gauge,
    event.chainId,
    context,
  );

  if (!poolEntity) {
    context.log.warn(
      `No pool address found for the gauge address ${event.params.gauge.toString()} on chain ${
        event.chainId
      }`,
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

  // Refresh reward token price if it's zero (token was just created or price fetch failed previously)
  // Or if more than 1h has passed since last update
  const updatedRewardToken = await refreshTokenPrice(
    rewardToken,
    event.block.number,
    event.block.timestamp,
    event.chainId,
    context,
    1000000n,
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
SuperchainLeafVoter.WhitelistToken.handler(async ({ event, context }) => {
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
      `Error in superchain leaf voter whitelist token event fetching token details for ${event.params.token} on chain ${event.chainId}: ${error}`,
    );
  }
});
