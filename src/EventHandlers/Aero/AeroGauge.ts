import { indexer } from "envio";
import {
  AERO_EMISSIONS_EVENT_KIND,
  AERO_STAKE_EVENT_KIND,
} from "./AeroConstants";
import {
  processAeroGaugeClaimFees,
  recordAeroEmissionsEvent,
} from "./AeroGaugeEmissionsLogic";
import { processAeroGaugeStake } from "./AeroGaugeStakingLogic";

/**
 * Aero gauges (ADR 0006), registered dynamically by the gauge factories'
 * GaugeCreated: CL gauges (`AeroCLGauge`, NFPM positions; amounts in
 * liquidity L) and V2 gauges (`AeroV2Gauge`, LP tokens). Staking events move
 * the pool's staked liquidity through the shared staking path; emissions
 * events become AeroEmissionsEvent rows; ClaimFees adds the staked
 * liquidity's pool fees sent to the rewards manager.
 */

// --------------------------------- CL gauges ---------------------------------

indexer.onEvent(
  { contract: "AeroCLGauge", event: "Deposit" },
  async ({ event, context }) => {
    await processAeroGaugeStake(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_STAKE_EVENT_KIND.DEPOSIT,
        account: event.params.user,
        caller: event.params.caller,
        tokenId: event.params.tokenId,
        amount: event.params.liquidityToStake,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "Withdraw" },
  async ({ event, context }) => {
    await processAeroGaugeStake(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_STAKE_EVENT_KIND.WITHDRAW,
        account: event.params.user,
        caller: event.params.caller,
        tokenId: event.params.tokenId,
        amount: event.params.liquidityToStake,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "EmergencyWithdraw" },
  async ({ event, context }) => {
    await processAeroGaugeStake(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_STAKE_EVENT_KIND.EMERGENCY_WITHDRAW,
        account: event.params.user,
        caller: undefined,
        tokenId: event.params.tokenId,
        amount: event.params.liquidityToStake,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "EmissionsClaimed" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.CLAIMED,
        account: event.params.account,
        recipient: event.params.recipient,
        referral: undefined,
        tokenId: event.params.tokenId,
        amount: event.params.rewardAmount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "EmissionsDeferred" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.DEFERRED,
        account: event.params.account,
        recipient: undefined,
        referral: undefined,
        tokenId: event.params.tokenId,
        amount: event.params.rewardAmount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "ReferralEmissionsDeferred" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.REFERRAL_DEFERRED,
        account: event.params.account,
        recipient: undefined,
        referral: event.params.referral,
        tokenId: event.params.tokenId,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "DeferredEmissionsClaimed" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.DEFERRED_CLAIMED,
        account: event.params.account,
        recipient: event.params.recipient,
        referral: undefined,
        tokenId: undefined,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "ReferralEmissionsClaimed" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.REFERRAL_CLAIMED,
        account: event.params.referral,
        recipient: event.params.recipient,
        referral: event.params.referral,
        tokenId: undefined,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "EarlyWithdrawPenalty" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.EARLY_WITHDRAW_PENALTY,
        account: event.params.from,
        recipient: undefined,
        referral: undefined,
        tokenId: event.params.tokenId,
        amount: event.params.penalty,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGauge", event: "ClaimFees" },
  async ({ event, context }) => {
    await processAeroGaugeClaimFees(
      event.chainId,
      event.srcAddress,
      event.params.claimed0,
      event.params.claimed1,
      event.block.timestamp,
      context,
    );
  },
);

// --------------------------------- V2 gauges ---------------------------------

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "Deposit" },
  async ({ event, context }) => {
    await processAeroGaugeStake(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_STAKE_EVENT_KIND.DEPOSIT,
        account: event.params.account,
        caller: event.params.caller,
        tokenId: undefined,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "Withdraw" },
  async ({ event, context }) => {
    await processAeroGaugeStake(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_STAKE_EVENT_KIND.WITHDRAW,
        account: event.params.account,
        caller: event.params.caller,
        tokenId: undefined,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "EmergencyWithdraw" },
  async ({ event, context }) => {
    await processAeroGaugeStake(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_STAKE_EVENT_KIND.EMERGENCY_WITHDRAW,
        account: event.params.account,
        caller: undefined,
        tokenId: undefined,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "EmissionsClaimed" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.CLAIMED,
        account: event.params.account,
        recipient: event.params.recipient,
        referral: undefined,
        tokenId: undefined,
        amount: event.params.rewardAmount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "EmissionsDeferred" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.DEFERRED,
        account: event.params.account,
        recipient: undefined,
        referral: undefined,
        tokenId: undefined,
        amount: event.params.rewardAmount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "ReferralEmissionsDeferred" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.REFERRAL_DEFERRED,
        account: event.params.account,
        recipient: undefined,
        referral: event.params.referral,
        tokenId: undefined,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "DeferredEmissionsClaimed" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.DEFERRED_CLAIMED,
        account: event.params.account,
        recipient: event.params.recipient,
        referral: undefined,
        tokenId: undefined,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "ReferralEmissionsClaimed" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.REFERRAL_CLAIMED,
        account: event.params.referral,
        recipient: event.params.recipient,
        referral: event.params.referral,
        tokenId: undefined,
        amount: event.params.amount,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "EarlyWithdrawPenalty" },
  async ({ event, context }) => {
    await recordAeroEmissionsEvent(
      {
        chainId: event.chainId,
        gaugeAddress: event.srcAddress,
        kind: AERO_EMISSIONS_EVENT_KIND.EARLY_WITHDRAW_PENALTY,
        account: event.params.account,
        recipient: undefined,
        referral: undefined,
        tokenId: undefined,
        amount: event.params.penalty,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        logIndex: event.logIndex,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2Gauge", event: "ClaimFees" },
  async ({ event, context }) => {
    await processAeroGaugeClaimFees(
      event.chainId,
      event.srcAddress,
      event.params.claimed0,
      event.params.claimed1,
      event.block.timestamp,
      context,
    );
  },
);
