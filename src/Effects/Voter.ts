import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import ERC20_ABI from "../../abis/ERC20.json";
import VOTER_ABI from "../../abis/Voter.json";
import { CHAIN_CONSTANTS, EFFECT_RATE_LIMITS } from "../Constants";
import { handleEffectErrorReturn } from "./Helpers";

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
  const { result } = await ethClient.simulateContract({
    address: rewardTokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [gaugeAddress],
    blockNumber: BigInt(blockNumber),
  });

  // viem should return a value for balanceOf, but to be defensive:
  // treat null/undefined/empty as 0 to avoid throwing.
  const balance =
    result === null || result === undefined || String(result) === ""
      ? 0n
      : BigInt(String(result));
  logger.info(
    `[fetchTokensDeposited] Tokens deposited fetched: ${balance}, rewardTokenAddress=${rewardTokenAddress}, gaugeAddress=${gaugeAddress}, blockNumber=${blockNumber}, chainID=${eventChainId}`,
  );
  return balance;
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
  const { result } = await ethClient.simulateContract({
    address: voterAddress as `0x${string}`,
    abi: VOTER_ABI,
    functionName: "isAlive",
    args: [gaugeAddress],
    blockNumber: BigInt(blockNumber),
  });

  const isAlive = Boolean(result);
  logger.info(
    `[fetchIsAlive] Gauge ${gaugeAddress} is alive: ${isAlive}, voterAddress=${voterAddress}, gaugeAddress=${gaugeAddress}, blockNumber=${blockNumber}, chainID=${eventChainId}`,
  );
  return isAlive;
}

/**
 * Voter Common Effects
 */

/**
 * Effect to get tokens deposited in a gauge
 *
 * Error handling: Returns undefined on error. Callers should check for undefined
 * and handle appropriately.
 */
export const getTokensDeposited = createEffect(
  {
    name: "getTokensDeposited",
    input: {
      rewardTokenAddress: S.string,
      gaugeAddress: S.string,
      blockNumber: S.number,
      eventChainId: S.number,
    },
    output: S.nullable(S.bigint),
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
      // Return undefined on error - callers should check and handle appropriately
      return handleEffectErrorReturn(
        error,
        context,
        "getTokensDeposited",
        { gaugeAddress, eventChainId, blockNumber },
        undefined,
      );
    }
  },
);

/**
 * Effect to check if a gauge is alive
 *
 * Error handling: Returns undefined on error. Callers should check for undefined
 * and handle appropriately.
 */
export const getIsAlive = createEffect(
  {
    name: "getIsAlive",
    input: {
      voterAddress: S.string,
      gaugeAddress: S.string,
      blockNumber: S.number,
      eventChainId: S.number,
    },
    output: S.nullable(S.boolean),
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
      // Return undefined on error - callers should check and handle appropriately
      return handleEffectErrorReturn(
        error,
        context,
        "getIsAlive",
        { gaugeAddress, eventChainId, blockNumber },
        undefined,
      );
    }
  },
);
