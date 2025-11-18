import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, EFFECT_RATE_LIMITS } from "../Constants";

/**
 * Core logic for fetching tokens deposited in a gauge
 * This can be tested independently of the Effect API
 */
export async function fetchTokensDeposited(
  rewardTokenAddress: string,
  gaugeAddress: string,
  blockNumber: number,
  eventChainId: number,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<bigint> {
  try {
    const ERC20GaugeABI = require("../../abis/ERC20.json");

    const { result } = await ethClient.simulateContract({
      address: rewardTokenAddress as `0x${string}`,
      abi: ERC20GaugeABI,
      functionName: "balanceOf",
      args: [gaugeAddress],
      blockNumber: BigInt(blockNumber),
    });

    const balance = BigInt(String(result) || "0");
    logger.info(
      `[fetchTokensDeposited] Tokens deposited fetched: ${balance}, rewardTokenAddress=${rewardTokenAddress}, gaugeAddress=${gaugeAddress}, blockNumber=${blockNumber}, chainID=${eventChainId}`,
    );
    return balance;
  } catch (error) {
    logger.error(
      `[fetchTokensDeposited] Error fetching tokens deposited for gauge ${gaugeAddress} on chain ${eventChainId} at block ${blockNumber}:`,
      error instanceof Error ? error : new Error(String(error)),
    );
    return 0n;
  }
}

/**
 * Core logic for checking if a gauge is alive
 * This can be tested independently of the Effect API
 */
export async function fetchIsAlive(
  voterAddress: string,
  gaugeAddress: string,
  blockNumber: number,
  eventChainId: number,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<boolean> {
  try {
    const VoterABI = require("../../abis/Voter.json");

    const { result } = await ethClient.simulateContract({
      address: voterAddress as `0x${string}`,
      abi: VoterABI,
      functionName: "isAlive",
      args: [gaugeAddress],
      blockNumber: BigInt(blockNumber),
    });

    const isAlive = Boolean(result);
    logger.info(
      `[fetchIsAlive] Gauge ${gaugeAddress} is alive: ${isAlive}, voterAddress=${voterAddress}, gaugeAddress=${gaugeAddress}, blockNumber=${blockNumber}, chainID=${eventChainId}`,
    );
    return isAlive;
  } catch (error) {
    logger.error(
      `[fetchIsAlive] Error checking if gauge ${gaugeAddress} is alive on chain ${eventChainId} at block ${blockNumber}:`,
      error instanceof Error ? error : new Error(String(error)),
    );
    return false;
  }
}

// Voter Common Effects
export const getTokensDeposited = createEffect(
  {
    name: "getTokensDeposited",
    input: {
      rewardTokenAddress: S.string,
      gaugeAddress: S.string,
      blockNumber: S.number,
      eventChainId: S.number,
    },
    output: S.bigint,
    rateLimit: {
      calls: EFFECT_RATE_LIMITS.VOTER_EFFECTS,
      per: "second",
    },
    cache: true,
  },
  async ({ input, context }) => {
    const { rewardTokenAddress, gaugeAddress, blockNumber, eventChainId } =
      input;
    const ethClient = CHAIN_CONSTANTS[eventChainId].eth_client;
    try {
      return await fetchTokensDeposited(
        rewardTokenAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        ethClient,
        context.log,
      );
    } catch (error) {
      // Don't cache failed response
      context.cache = false;
      context.log.error(
        `[getTokensDeposited] Error in effect for gauge ${gaugeAddress} on chain ${eventChainId} at block ${blockNumber}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      // Return zero on error to prevent processing failures
      return 0n;
    }
  },
);

export const getIsAlive = createEffect(
  {
    name: "getIsAlive",
    input: {
      voterAddress: S.string,
      gaugeAddress: S.string,
      blockNumber: S.number,
      eventChainId: S.number,
    },
    output: S.boolean,
    rateLimit: {
      calls: EFFECT_RATE_LIMITS.VOTER_EFFECTS,
      per: "second",
    },
    cache: true,
  },
  async ({ input, context }) => {
    const { voterAddress, gaugeAddress, blockNumber, eventChainId } = input;
    const ethClient = CHAIN_CONSTANTS[eventChainId].eth_client;
    try {
      return await fetchIsAlive(
        voterAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        ethClient,
        context.log,
      );
    } catch (error) {
      // Don't cache failed response
      context.cache = false;
      context.log.error(
        `[getIsAlive] Error in effect for gauge ${gaugeAddress} on chain ${eventChainId} at block ${blockNumber}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      // Return false on error to prevent processing failures
      return false;
    }
  },
);
