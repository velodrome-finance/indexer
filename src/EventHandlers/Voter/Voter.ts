import { Voter } from "generated";

import type { Token } from "generated";
import {
  findPoolByGaugeAddress,
  isMissingRootPoolMapping,
  loadPoolDataOrRootCLPool,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import {
  loadOrCreateVeNFTPoolVote,
  updateVeNFTPoolVote,
} from "../../Aggregators/VeNFTPoolVote";
import { loadVeNFTState } from "../../Aggregators/VeNFTState";
import {
  CHAIN_CONSTANTS,
  PendingDistributionId,
  PoolId,
  RootGaugeRootPoolId,
  TokenId,
  VOTER_CLPOOLS_FACTORY_LIST,
  VOTER_NONCL_POOLS_FACTORY_LIST,
} from "../../Constants";
import { getTokenDetails } from "../../Effects/Index";
import { refreshTokenPrice } from "../../PriceOracle";
import {
  VoterEventType,
  buildPoolDiffFromDistribute,
  computeVoterDistributeValues,
  computeVoterRelatedEntitiesDiff,
  createPendingVoteForDeferredProcessing,
  resolveLeafPoolForRootGauge,
} from "./VoterCommonLogic";

Voter.GaugeCreated.contractRegister(({ event, context }) => {
  const pf = event.params.poolFactory;
  if (VOTER_CLPOOLS_FACTORY_LIST.includes(pf)) {
    context.addCLGauge(event.params.gauge);
  } else if (VOTER_NONCL_POOLS_FACTORY_LIST.includes(pf)) {
    context.addGauge(event.params.gauge);
  }

  context.addFeesVotingReward(event.params.feeVotingReward);
  context.addBribesVotingReward(event.params.bribeVotingReward);
});

Voter.GaugeCreated.handler(async ({ event, context }) => {
  // Update the pool entity with the gauge address
  const poolId = PoolId(event.chainId, event.params.pool);
  const gaugeAddress = event.params.gauge;

  const poolEntity = await context.LiquidityPoolAggregator.get(poolId);

  if (poolEntity) {
    const poolUpdateDiff = {
      gaugeAddress: gaugeAddress,
      feeVotingRewardAddress: event.params.feeVotingReward,
      bribeVotingRewardAddress: event.params.bribeVotingReward,
      gaugeIsAlive: true, // Newly created gauges are always alive
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updateLiquidityPoolAggregator(
      poolUpdateDiff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  } else {
    // RootPool case: no LiquidityPoolAggregator on this chain
    // Store root gauge → root pool for DistributeReward cross-chain resolution
    const id = RootGaugeRootPoolId(event.chainId, event.params.gauge);
    context.RootGauge_RootPool.set({
      id,
      rootChainId: event.chainId,
      rootGaugeAddress: event.params.gauge,
      rootPoolAddress: event.params.pool,
    });
  }
});

// Leads to a deposit of veNFT
Voter.Voted.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;
  const timestamp = new Date(event.block.timestamp * 1000);
  const pool = event.params.pool;
  const chainId = event.chainId;

  // Load pool data and token owner concurrently for better performance
  const [poolResult, veNFTState] = await Promise.all([
    loadPoolDataOrRootCLPool(
      pool,
      chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadVeNFTState(chainId, tokenId, context),
  ]);

  if (!poolResult.ok) {
    // If the root pool mapping cannot be loaded, create a pending vote for deferred processing
    if (isMissingRootPoolMapping(poolResult)) {
      if (!veNFTState) {
        return;
      }
      createPendingVoteForDeferredProcessing(
        context,
        chainId,
        pool,
        tokenId,
        event.params.weight,
        VoterEventType.VOTED,
        timestamp,
        event.block.number,
        event.transaction.hash,
        event.logIndex,
      );
    }
    return;
  }

  if (!veNFTState) {
    return;
  }

  const poolData = poolResult.poolData;
  const { liquidityPoolAggregator } = poolData;
  const poolChainId = liquidityPoolAggregator.chainId;
  const poolAddress = liquidityPoolAggregator.poolAddress;

  const [veNFTPoolVote, userStats] = await Promise.all([
    loadOrCreateVeNFTPoolVote(
      poolChainId,
      tokenId,
      poolAddress,
      veNFTState,
      context,
      timestamp,
    ),
    loadOrCreateUserData(
      veNFTState.owner,
      poolAddress,
      poolChainId,
      context,
      timestamp,
    ),
  ]);

  const { poolVoteDiff, userStatsPerPoolDiff, veNFTPoolVoteDiff } =
    computeVoterRelatedEntitiesDiff(
      event.params.totalWeight,
      event.params.weight,
      veNFTState,
      timestamp,
      VoterEventType.VOTED,
    );

  await Promise.all([
    updateLiquidityPoolAggregator(
      poolVoteDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.chainId,
      event.block.number,
    ),
    updateUserStatsPerPool(
      userStatsPerPoolDiff,
      userStats,
      context,
      timestamp,
      poolData,
    ),
    updateVeNFTPoolVote(veNFTPoolVoteDiff, veNFTPoolVote, context),
  ]);
});

// The opposite of the Voted event: effectively withdraws veNFT
Voter.Abstained.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;
  const timestamp = new Date(event.block.timestamp * 1000);
  const pool = event.params.pool;
  const chainId = event.chainId;

  // Load pool data and token owner concurrently for better performance
  const [poolResult, veNFTState] = await Promise.all([
    loadPoolDataOrRootCLPool(
      pool,
      chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadVeNFTState(chainId, tokenId, context),
  ]);

  // If the pool data (or root pool mapping) cannot be loaded, create a pending vote for deferred processing
  if (!poolResult.ok) {
    if (isMissingRootPoolMapping(poolResult)) {
      if (!veNFTState) {
        return;
      }
      createPendingVoteForDeferredProcessing(
        context,
        chainId,
        pool,
        tokenId,
        event.params.weight,
        VoterEventType.ABSTAINED,
        timestamp,
        event.block.number,
        event.transaction.hash,
        event.logIndex,
      );
    }
    return;
  }

  if (!veNFTState) {
    return;
  }

  const poolData = poolResult.poolData;
  const { liquidityPoolAggregator } = poolData;
  const poolChainId = liquidityPoolAggregator.chainId;
  const poolAddress = liquidityPoolAggregator.poolAddress;

  const { poolVoteDiff, userStatsPerPoolDiff, veNFTPoolVoteDiff } =
    computeVoterRelatedEntitiesDiff(
      event.params.totalWeight,
      event.params.weight,
      veNFTState,
      timestamp,
      VoterEventType.ABSTAINED,
    );

  const [veNFTPoolVote, userStats] = await Promise.all([
    loadOrCreateVeNFTPoolVote(
      poolChainId,
      tokenId,
      poolAddress,
      veNFTState,
      context,
      timestamp,
    ),
    loadOrCreateUserData(
      veNFTState.owner,
      poolAddress,
      poolChainId,
      context,
      timestamp,
    ),
  ]);

  await Promise.all([
    updateLiquidityPoolAggregator(
      poolVoteDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.chainId,
      event.block.number,
    ),
    updateUserStatsPerPool(
      userStatsPerPoolDiff,
      userStats,
      context,
      timestamp,
      poolData,
    ),
    updateVeNFTPoolVote(veNFTPoolVoteDiff, veNFTPoolVote, context),
  ]);
});

Voter.DistributeReward.handler(async ({ event, context }) => {
  const eventChainId = event.chainId;
  const rewardTokenAddress = CHAIN_CONSTANTS[eventChainId].rewardToken(
    event.block.number,
  );

  const [poolResult, rewardToken] = await Promise.all([
    (async () => {
      const poolEntity = await findPoolByGaugeAddress(
        event.params.gauge,
        eventChainId,
        context,
      );
      if (poolEntity) {
        const pool =
          (await context.LiquidityPoolAggregator.get(poolEntity.id)) ?? null;
        return pool ? { pool, isCrossChain: false } : null;
      }
      return resolveLeafPoolForRootGauge(
        context,
        eventChainId,
        event.params.gauge,
      );
    })(),
    context.Token.get(TokenId(eventChainId, rewardTokenAddress)),
  ]);

  if (!poolResult || !rewardToken) {
    // If this is a root gauge but RootPool_LeafPool mapping is missing, defer for later processing
    if (poolResult === null) {
      const rootGaugeMapping = await context.RootGauge_RootPool.get(
        RootGaugeRootPoolId(eventChainId, event.params.gauge),
      );
      if (rootGaugeMapping) {
        const rootPoolLeafPools =
          (await context.RootPool_LeafPool.getWhere({
            rootPoolAddress: { _eq: rootGaugeMapping.rootPoolAddress },
          })) ?? [];
        if (rootPoolLeafPools.length !== 1) {
          const logIndex = event.logIndex;
          context.PendingDistribution.set({
            id: PendingDistributionId(
              eventChainId,
              rootGaugeMapping.rootPoolAddress,
              event.block.number,
              logIndex,
            ),
            rootChainId: eventChainId,
            rootPoolAddress: rootGaugeMapping.rootPoolAddress,
            gaugeAddress: event.params.gauge,
            amount: event.params.amount,
            blockNumber: BigInt(event.block.number),
            blockTimestamp: new Date(event.block.timestamp * 1000),
            logIndex,
          });
          return;
        }
      }
    }
    return;
  }

  const currentLiquidityPool = poolResult.pool;
  const isCrossChainDistribution = poolResult.isCrossChain;

  // Refresh reward token price if it's zero (token was just created or price fetch failed previously)
  // Or if more than 1h has passed since last update
  const updatedRewardToken = await refreshTokenPrice(
    rewardToken,
    event.block.number,
    event.block.timestamp,
    eventChainId,
    context,
  );

  const result = await computeVoterDistributeValues(
    updatedRewardToken,
    event.params.gauge,
    event.params.amount,
    event.block.number,
    eventChainId,
    context,
    currentLiquidityPool.gaugeIsAlive ?? false,
  );

  const timestampMs = event.block.timestamp * 1000;
  const poolDiff = buildPoolDiffFromDistribute(
    result,
    timestampMs,
    isCrossChainDistribution ? undefined : event.params.gauge,
  );

  await updateLiquidityPoolAggregator(
    poolDiff,
    currentLiquidityPool,
    new Date(timestampMs),
    context,
    // For cross-chain distributions, pass eventChainId (OP) so the dynamic fee
    // guard in updateDynamicFeePools detects the chain mismatch and skips.
    isCrossChainDistribution ? eventChainId : currentLiquidityPool.chainId,
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
    TokenId(event.chainId, event.params.token),
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
      id: TokenId(event.chainId, event.params.token),
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
  const poolId = poolEntity?.id;

  if (poolId) {
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
      event.chainId,
      event.block.number,
    );
  }
});

Voter.GaugeRevived.handler(async ({ event, context }) => {
  const poolEntity = await findPoolByGaugeAddress(
    event.params.gauge,
    event.chainId,
    context,
  );
  const poolId = poolEntity?.id;

  if (poolId) {
    const poolUpdateDiff = {
      gaugeIsAlive: true,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updateLiquidityPoolAggregator(
      poolUpdateDiff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  }
});
