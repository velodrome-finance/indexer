import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS } from "../Constants";

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

/**
 * Core logic for fetching accumulated gauge fees for CL pools
 * This can be tested independently of the Effect API
 */
export async function fetchCurrentAccumulatedFeeCL(
  poolAddress: string,
  chainId: number,
  blockNumber: number,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<{ token0Fees: bigint; token1Fees: bigint }> {
  try {
    logger.info(
      `[fetchCurrentAccumulatedFeeCL] Fetching accumulated gauge fees for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}`,
    );
    const CLPoolABI = require("../../abis/CLPool.json");

    const { result } = await ethClient.simulateContract({
      address: poolAddress as `0x${string}`,
      abi: CLPoolABI,
      functionName: "gaugeFees",
      args: [],
      blockNumber: BigInt(blockNumber),
    });

    const gaugeFees = {
      token0Fees: result[0],
      token1Fees: result[1],
    };

    logger.info(
      `[fetchCurrentAccumulatedFeeCL] Accumulated gauge fees fetched: token0Fees=${gaugeFees.token0Fees}, token1Fees=${gaugeFees.token1Fees}`,
    );
    return gaugeFees;
  } catch (error) {
    logger.error(
      `[fetchCurrentAccumulatedFeeCL] Error fetching accumulated gauge fees for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}:`,
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
      calls: 1,
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

export const getCurrentAccumulatedFeeCL = createEffect(
  {
    name: "getCurrentAccumulatedFeeCL",
    input: {
      poolAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    output: {
      token0Fees: S.bigint,
      token1Fees: S.bigint,
    },
    rateLimit: {
      calls: 1,
      per: "second",
    },
    cache: true,
  },
  async ({ input, context }) => {
    const { poolAddress, chainId, blockNumber } = input;
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    try {
      const result = await fetchCurrentAccumulatedFeeCL(
        poolAddress,
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
        `[getCurrentAccumulatedFeeCL] Error in effect for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  },
);
