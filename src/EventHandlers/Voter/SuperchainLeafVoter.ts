import type { Token } from "envio";
import { indexer } from "envio";
import { findPoolByGaugeAddress, updatePool } from "../../Aggregators/Pool";
import {
  PoolId,
  SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
  SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST,
  TokenId,
  isValidEvmAddress,
} from "../../Constants";
import { getTokenDetails, hasContractBytecode } from "../../Effects/Index";
import { getRehydrated } from "../../EntityTimestamps";
import { healTokenMetadata } from "../../PriceOracle";
import { getGateDecisionFromSignals } from "../../PriceTrust";

indexer.contractRegister(
  { contract: "SuperchainLeafVoter", event: "GaugeCreated" },
  async ({ event, context }) => {
    const pf = event.params.poolFactory;
    if (SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST.includes(pf)) {
      context.chain.CLGauge.add(event.params.gauge);
    } else if (SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST.includes(pf)) {
      context.chain.Gauge.add(event.params.gauge);
    }

    context.chain.FeesVotingReward.add(event.params.feeVotingReward);
    context.chain.SuperchainIncentiveVotingReward.add(
      event.params.incentiveVotingReward,
    );
  },
);

indexer.onEvent(
  { contract: "SuperchainLeafVoter", event: "GaugeCreated" },
  async ({ event, context }) => {
    // Update the pool entity with the gauge address
    const poolId = PoolId(event.chainId, event.params.pool);
    const gaugeAddress = event.params.gauge;

    const poolEntity = await getRehydrated(context.Pool, "Pool", poolId);

    if (poolEntity) {
      const poolUpdateDiff = {
        gaugeAddress: gaugeAddress,
        feeVotingRewardAddress: event.params.feeVotingReward,
        bribeVotingRewardAddress: event.params.incentiveVotingReward,
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
    }
  },
);

indexer.onEvent(
  { contract: "SuperchainLeafVoter", event: "GaugeKilled" },
  async ({ event, context }) => {
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
  { contract: "SuperchainLeafVoter", event: "GaugeRevived" },
  async ({ event, context }) => {
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
  { contract: "SuperchainLeafVoter", event: "WhitelistToken" },
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

    // Issue #845: defense-in-depth. A decoder mismatch (e.g. #844) can deliver
    // an `undefined`/garbage token here; persisting it would write a Token with
    // a malformed `${chainId}-` id (hasContractBytecode fail-opens to `true`
    // once RPCs are exhausted, so the bytecode gate below would not catch it).
    // Skip + warn before any effect runs, mirroring createTokenEntity's guard.
    if (!isValidEvmAddress(event.params.token)) {
      context.log.warn(
        `[SuperchainLeafVoter.WhitelistToken] Skipping Token row for invalid address ${event.params.token} on chain ${event.chainId}`,
      );
      return;
    }

    try {
      const { hasCode } = await context.effect(hasContractBytecode, {
        address: event.params.token,
        chainId: event.chainId,
      });
      if (!hasCode) {
        context.log.warn(
          `[SuperchainLeafVoter.WhitelistToken] Skipping Token row for non-contract address ${event.params.token} on chain ${event.chainId} (no deployed bytecode)`,
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
        pricePerUSDNew: 0n,
        address: event.params.token,
        chainId: event.chainId,
        decimals: BigInt(tokenDetails.decimals),
        isWhitelisted: event.params._bool,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
        lastSuccessfulPriceTimestamp: undefined,
        priceTrustOutcome: decision.outcome,
        priceTrustReason: decision.reason,
      };
      context.Token.set(updatedToken);
    } catch (error) {
      context.log.error(
        `Error in superchain leaf voter whitelist token event fetching token details for ${event.params.token} on chain ${event.chainId}: ${error}`,
      );
    }
  },
);
