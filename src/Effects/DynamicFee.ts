import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, EFFECT_RATE_LIMITS } from "../Constants";

/**
 * Core logic for fetching current fee
 * This can be tested independently of the Effect API
 */
export async function fetchCurrentFee(
  poolAddress: string,
  dynamicFeeModuleAddress: string,
  chainId: number,
  blockNumber: number,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<bigint> {
  try {
    logger.info(
      `[fetchCurrentFee] Fetching current fee for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}`,
    );
    const DynamicFeePoolABI = require("../../abis/DynamicFeeSwapModule.json");

    const { result } = await ethClient.simulateContract({
      address: dynamicFeeModuleAddress as `0x${string}`,
      abi: DynamicFeePoolABI,
      functionName: "getFee",
      args: [poolAddress],
      blockNumber: BigInt(blockNumber),
    });

    logger.info(`[fetchCurrentFee] Current fee fetched: ${result}`);
    return result as unknown as bigint;
  } catch (error) {
    logger.error(
      `[fetchCurrentFee] Error fetching current fee for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}:`,
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

export const getCurrentFee = createEffect(
  {
    name: "getCurrentFee",
    input: {
      poolAddress: S.string,
      dynamicFeeModuleAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    output: S.bigint,
    rateLimit: {
      calls: EFFECT_RATE_LIMITS.DYNAMIC_FEE_EFFECTS,
      per: "second",
    },
    cache: true,
  },
  async ({ input, context }) => {
    const { poolAddress, dynamicFeeModuleAddress, chainId, blockNumber } =
      input;
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    try {
      const result = await fetchCurrentFee(
        poolAddress,
        dynamicFeeModuleAddress,
        chainId,
        blockNumber,
        ethClient,
        context.log,
      );
      return result;
    } catch (error) {
      // Don't cache failed response
      context.cache = false;
      context.log.error(
        `[getCurrentFee] Error in effect for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  },
);
