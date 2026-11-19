import { indexer } from "envio";

import type { EvmEvent, Token } from "envio";
import {
  findPoolByGaugeAddress,
  loadPoolData,
  updatePool,
} from "../../Aggregators/Pool";
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
  PoolId,
  RootGaugeRootPoolId,
  TokenId,
  VOTER_CLPOOLS_FACTORY_LIST,
  VOTER_NONCL_POOLS_FACTORY_LIST,
  getLegacyConstants,
} from "../../Constants";
import { getTokenDetails, hasContractBytecode } from "../../Effects/Index";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import {
  healTokenMetadata,
  initialTokenPriceFields,
  refreshTokenPrice,
} from "../../PriceOracle";
import { getGateDecisionFromSignals } from "../../PriceTrust";
import {
  SUPERCHAIN_ROOT_CHAIN_ID,
  applyRootPoolDistribution,
  applyRootPoolVote,
  loadRootPoolByGauge,
  setRootPoolGauge,
} from "./RootPoolLogic";
import {
  VoterEventType,
  buildPoolDiffFromDistribute,
  computeVoterDistributeValues,
  computeVoterRelatedEntitiesDiff,
} from "./VoterCommonLogic";

indexer.contractRegister(
  { contract: "Voter", event: "GaugeCreated" },
  async ({ event, context }) => {
    const pf = event.params.poolFactory;
    if (VOTER_CLPOOLS_FACTORY_LIST.includes(pf)) {
      context.chain.CLGauge.add(event.params.gauge);
    } else if (VOTER_NONCL_POOLS_FACTORY_LIST.includes(pf)) {
      context.chain.Gauge.add(event.params.gauge);
    }

    context.chain.FeesVotingReward.add(event.params.feeVotingReward);
    context.chain.BribesVotingReward.add(event.params.bribeVotingReward);
  },
);

indexer.onEvent(
  { contract: "Voter", event: "GaugeCreated" },
  async ({ event, context }) => {
    // Update the pool entity with the gauge address
    const poolId = PoolId(event.chainId, event.params.pool);
    const gaugeAddress = event.params.gauge;

    const poolEntity = await getRehydrated(context.Pool, "Pool", poolId);

    if (poolEntity) {
      const poolUpdateDiff = {
        gaugeAddress: gaugeAddress,
        feeVotingRewardAddress: event.params.feeVotingReward,
        bribeVotingRewardAddress: event.params.bribeVotingReward,
        gaugeIsAlive: true, // Newly created gauges are always alive
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      await updatePool(
        poolUpdateDiff,
        poolEntity,
        new Date(event.block.timestamp * 1000),
        context,
        event.chainId,
        event.block.number,
      );
    } else {
      // RootPool case: no Pool on this chain
      // Store root gauge → root pool for DistributeReward cross-chain resolution
      const id = RootGaugeRootPoolId(event.chainId, event.params.gauge);
      context.RootGauge_RootPool.set({
        id,
        rootChainId: event.chainId,
        rootGaugeAddress: event.params.gauge,
        rootPoolAddress: event.params.pool,
      });
      await setRootPoolGauge(
        event.chainId,
        event.params.pool,
        gaugeAddress,
        true,
        new Date(event.block.timestamp * 1000),
        context,
      );
    }
  },
);

/**
 * A Voted / Abstained: on the root chain, a superchain root pool's vote goes to
 * its `RootPool` / `RootPoolVote` (ADR 0009, flow A); a local pool's to the
 * pool, the voter's `UserStatsPerPool` and `VeNFTPoolVote`. A pool that is
 * neither (a known sink, an unindexed pool) is ignored.
 *
 * @param event - The Voted or Abstained event
 * @param eventType - Which of the two it is
 * @param context - Handler context
 * @returns Promise that resolves once the updates are staged
 */
async function applyVoterVote(
  event: EvmEvent<"Voter", "Voted"> | EvmEvent<"Voter", "Abstained">,
  eventType: VoterEventType,
  context: handlerContext,
): Promise<void> {
  const tokenId = event.params.tokenId;
  const timestamp = new Date(event.block.timestamp * 1000);
  const pool = event.params.pool;
  const chainId = event.chainId;

  const isRootPool = await applyRootPoolVote(
    chainId,
    pool,
    tokenId,
    event.params.weight,
    event.params.totalWeight,
    eventType,
    timestamp,
    context,
  );
  if (isRootPool) {
    return;
  }

  // A missing pool is expected (a root pool whose RootPoolCreated is not
  // indexed, a sink root pool), so it is not logged as an error.
  const [poolData, veNFTState] = await Promise.all([
    loadPoolData(
      pool,
      chainId,
      context,
      event.block.number,
      event.block.timestamp,
      true,
    ),
    loadVeNFTState(chainId, tokenId, context),
  ]);
  if (!poolData || !veNFTState) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;
  const poolAddress = liquidityPoolAggregator.poolAddress;

  const [veNFTPoolVote, userStats] = await Promise.all([
    loadOrCreateVeNFTPoolVote(
      chainId,
      tokenId,
      poolAddress,
      veNFTState,
      context,
      timestamp,
    ),
    loadOrCreateUserData(
      veNFTState.owner,
      poolAddress,
      chainId,
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
      eventType,
    );

  await Promise.all([
    updatePool(
      poolVoteDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      chainId,
      event.block.number,
    ),
    updateUserStatsPerPool(
      userStatsPerPoolDiff,
      userStats,
      context,
      timestamp,
      chainId,
      poolData,
    ),
    updateVeNFTPoolVote(veNFTPoolVoteDiff, veNFTPoolVote, context),
  ]);
}

// Leads to a deposit of veNFT
indexer.onEvent(
  { contract: "Voter", event: "Voted" },
  async ({ event, context }) => {
    await applyVoterVote(event, VoterEventType.VOTED, context);
  },
);

// The opposite of the Voted event: effectively withdraws veNFT
indexer.onEvent(
  { contract: "Voter", event: "Abstained" },
  async ({ event, context }) => {
    await applyVoterVote(event, VoterEventType.ABSTAINED, context);
  },
);

// A DistributeReward: to a local pool's gauge, the pool's emissions and gauge
// balance; on the root chain, to a root gauge, its RootPool's emissions
// (ADR 0009, flow B), valued with the reward token refreshed at this event.
// Anything else (a sink root pool, an unindexed gauge) is ignored.
indexer.onEvent(
  { contract: "Voter", event: "DistributeReward" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const rewardTokenAddress = getLegacyConstants(chainId).rewardToken(
      event.block.number,
    );
    const [poolEntity, rewardToken] = await Promise.all([
      findPoolByGaugeAddress(event.params.gauge, chainId, context),
      getRehydrated(
        context.Token,
        "Token",
        TokenId(chainId, rewardTokenAddress),
      ),
    ]);

    if (!poolEntity) {
      // Only a root gauge's RootPool takes it: refresh the reward token for
      // nothing else (an unknown or sink gauge is ignored without a write).
      if (
        chainId !== SUPERCHAIN_ROOT_CHAIN_ID ||
        !(await loadRootPoolByGauge(chainId, event.params.gauge, context))
      ) {
        return;
      }
      const pricedRewardToken = rewardToken
        ? await refreshTokenPrice(
            rewardToken,
            event.block.number,
            event.block.timestamp,
            chainId,
            context,
          )
        : undefined;
      await applyRootPoolDistribution(
        chainId,
        event.params.gauge,
        event.params.amount,
        pricedRewardToken,
        new Date(event.block.timestamp * 1000),
        context,
      );
      return;
    }

    const currentLiquidityPool = await getRehydrated(
      context.Pool,
      "Pool",
      poolEntity.id,
    );
    if (!currentLiquidityPool || !rewardToken) {
      return;
    }

    // Refresh the reward token's price (at most once per clock hour).
    const updatedRewardToken = await refreshTokenPrice(
      rewardToken,
      event.block.number,
      event.block.timestamp,
      chainId,
      context,
    );

    const result = computeVoterDistributeValues(
      updatedRewardToken,
      currentLiquidityPool,
      event.params.gauge,
      event.params.amount,
      chainId,
      context,
      currentLiquidityPool.gaugeIsAlive ?? false,
    );

    const timestampMs = event.block.timestamp * 1000;
    await updatePool(
      buildPoolDiffFromDistribute(result, timestampMs, event.params.gauge),
      currentLiquidityPool,
      new Date(timestampMs),
      context,
      chainId,
      event.block.number,
    );
  },
);

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
indexer.onEvent(
  { contract: "Voter", event: "WhitelistToken" },
  async ({ event, context }) => {
    const token = await getRehydrated(
      context.Token,
      "Token",
      TokenId(event.chainId, event.params.token),
    );

    // Update the Token entity in the DB, either by updating the existing one or creating a new one
    if (token) {
      // Issue #820: heal frozen metadata (empty symbol/name, fallback-origin
      // decimals) for whitelisted tokens that may never hit refreshTokenPrice —
      // a token that is never a pool or reward token never reaches the heal
      // lifted above the throttle there. WhitelistToken is the one recurring
      // path such tokens traverse, mirroring the #761 priceTrust recompute
      // below. healTokenMetadata short-circuits without an RPC once symbol+name
      // are populated, so the common (already-healed) case stays free.
      const healed = await healTokenMetadata(token, event.chainId, context);

      // Recompute the price-trust gate alongside isWhitelisted so the persisted
      // priceTrustOutcome/priceTrustReason stay in lockstep with the whitelist
      // signal. Without this, tokens first observed via pool events before
      // their WhitelistToken event would stay UNTRUSTED/NON_WL forever (#761).
      const decision = getGateDecisionFromSignals(
        event.chainId,
        event.params.token,
        event.params._bool,
        token.isListedOnAero ?? false,
      );
      const updatedToken: Token = {
        ...healed,
        isWhitelisted: event.params._bool,
        priceTrustOutcome: decision.outcome,
        priceTrustReason: decision.reason,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      context.Token.set(updatedToken as Token);
      return;
    }

    try {
      const { hasCode } = await context.effect(hasContractBytecode, {
        address: event.params.token,
        chainId: event.chainId,
      });
      if (!hasCode) {
        context.log.warn(
          `[Voter.WhitelistToken] Skipping Token row for non-contract address ${event.params.token} on chain ${event.chainId} (no deployed bytecode)`,
        );
        return;
      }

      const tokenDetails = await context.effect(getTokenDetails, {
        contractAddress: event.params.token,
        chainId: event.chainId,
      });
      const decision = getGateDecisionFromSignals(
        event.chainId,
        event.params.token,
        event.params._bool,
      );
      const updatedToken: Token = {
        id: TokenId(event.chainId, event.params.token),
        name: tokenDetails.name,
        symbol: tokenDetails.symbol,
        ...initialTokenPriceFields(
          event.chainId,
          event.params.token,
          new Date(event.block.timestamp * 1000),
        ),
        address: event.params.token,
        decimals: BigInt(tokenDetails.decimals),
        isWhitelisted: event.params._bool,
        isListedOnAero: undefined,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
        priceTrustOutcome: decision.outcome,
        priceTrustReason: decision.reason,
      };
      context.Token.set(updatedToken);
    } catch (error) {
      context.log.error(
        `Error in whitelist token event fetching token details for ${event.params.token} on chain ${event.chainId}: ${error}`,
      );
    }
  },
);

indexer.onEvent(
  { contract: "Voter", event: "GaugeKilled" },
  async ({ event, context }) => {
    // Update the pool entity - mark gauge as not alive and clear gauge address
    // Keep voting reward addresses as historical data
    const poolEntity = await findPoolByGaugeAddress(
      event.params.gauge,
      event.chainId,
      context,
    );
    const poolId = poolEntity?.id;

    if (!poolId) {
      await setRootPoolGauge(
        event.chainId,
        undefined,
        event.params.gauge,
        false,
        new Date(event.block.timestamp * 1000),
        context,
      );
    }
    if (poolId) {
      const poolUpdateDiff = {
        gaugeIsAlive: false,
        // Keep gaugeAddress, feeVotingRewardAddress and bribeVotingRewardAddress as historical data
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      await updatePool(
        poolUpdateDiff,
        poolEntity,
        new Date(event.block.timestamp * 1000),
        context,
        event.chainId,
        event.block.number,
      );
    }
  },
);

indexer.onEvent(
  { contract: "Voter", event: "GaugeRevived" },
  async ({ event, context }) => {
    const poolEntity = await findPoolByGaugeAddress(
      event.params.gauge,
      event.chainId,
      context,
    );
    const poolId = poolEntity?.id;

    if (!poolId) {
      await setRootPoolGauge(
        event.chainId,
        undefined,
        event.params.gauge,
        true,
        new Date(event.block.timestamp * 1000),
        context,
      );
    }
    if (poolId) {
      const poolUpdateDiff = {
        gaugeIsAlive: true,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      await updatePool(
        poolUpdateDiff,
        poolEntity,
        new Date(event.block.timestamp * 1000),
        context,
        event.chainId,
        event.block.number,
      );
    }
  },
);
