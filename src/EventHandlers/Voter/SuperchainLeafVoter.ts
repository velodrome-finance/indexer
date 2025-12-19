import { SuperchainLeafVoter } from "generated";

import type { Token } from "generated/src/Types.gen";
import { updateLiquidityPoolAggregator } from "../../Aggregators/LiquidityPoolAggregator";
import {
  SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
  SUPERCHAIN_LEAF_VOTER_VAMM_POOLS_FACTORY_LIST,
  TokenIdByChain,
  toChecksumAddress,
} from "../../Constants";
import { getTokenDetails } from "../../Effects/Index";

SuperchainLeafVoter.GaugeCreated.contractRegister(({ event, context }) => {
  const pf = toChecksumAddress(event.params.poolFactory);
  if (SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST.includes(pf)) {
    context.addCLGauge(event.params.gauge);
  } else if (SUPERCHAIN_LEAF_VOTER_VAMM_POOLS_FACTORY_LIST.includes(pf)) {
    context.addGauge(event.params.gauge);
  }

  context.addFeesVotingReward(event.params.feeVotingReward);
  context.addSuperchainIncentiveVotingReward(
    event.params.incentiveVotingReward,
  );
});

SuperchainLeafVoter.GaugeCreated.handler(async ({ event, context }) => {
  // Update the pool entity with the gauge address
  const poolAddress = toChecksumAddress(event.params.pool);
  const gaugeAddress = toChecksumAddress(event.params.gauge);

  const poolEntity = await context.LiquidityPoolAggregator.get(poolAddress);

  if (poolEntity) {
    const poolUpdateDiff = {
      gaugeAddress: gaugeAddress,
      feeVotingRewardAddress: event.params.feeVotingReward,
      bribeVotingRewardAddress: event.params.incentiveVotingReward,
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
      `Error in superchain leaf voter whitelist token event fetching token details for ${event.params.token} on chain ${event.chainId}: ${error}`,
    );
  }
});
