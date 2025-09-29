import { S, experimental_createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS } from "../Constants";

/**
 * Core logic for fetching dynamic fee configuration
 * This can be tested independently of the Effect API
 */
export async function fetchDynamicFeeConfig(
  poolAddress: string,
  chainId: number,
  blockNumber: number,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<{ baseFee: bigint; feeCap: bigint; scalingFactor: bigint }> {
  try {
    logger.info(
      `[fetchDynamicFeeConfig] Fetching dynamic fee config for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}`,
    );
    const DynamicFeePoolABI = require("../../abis/DynamicFeeSwapModule.json");
    const DYNAMIC_FEE_MODULE_ADDRESS =
      "0xd9eE4FBeE92970509ec795062cA759F8B52d6720"; // CA for dynamic fee module

    const { result } = await ethClient.simulateContract({
      address: DYNAMIC_FEE_MODULE_ADDRESS as `0x${string}`,
      abi: DynamicFeePoolABI,
      functionName: "dynamicFeeConfig",
      args: [poolAddress],
      blockNumber: BigInt(blockNumber),
    });

    const dynamicFeeConfig = {
      baseFee: result[0],
      feeCap: result[1],
      scalingFactor: result[2],
    };

    logger.info(
      `[fetchDynamicFeeConfig] Dynamic fee config fetched: baseFee=${dynamicFeeConfig.baseFee}, feeCap=${dynamicFeeConfig.feeCap}, scalingFactor=${dynamicFeeConfig.scalingFactor}`,
    );
    return dynamicFeeConfig;
  } catch (error) {
    logger.error(
      `[fetchDynamicFeeConfig] Error fetching dynamic fee config for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}:`,
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

/**
 * Core logic for fetching current fee
 * This can be tested independently of the Effect API
 */
export async function fetchCurrentFee(
  poolAddress: string,
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
    const DYNAMIC_FEE_MODULE_ADDRESS =
      "0xd9eE4FBeE92970509ec795062cA759F8B52d6720"; // CA for dynamic fee module

    const { result } = await ethClient.simulateContract({
      address: DYNAMIC_FEE_MODULE_ADDRESS as `0x${string}`,
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

// Dynamic Fee Module Effects
export const getDynamicFeeConfig = experimental_createEffect(
  {
    name: "getDynamicFeeConfig",
    input: {
      poolAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    output: {
      baseFee: S.bigint,
      feeCap: S.bigint,
      scalingFactor: S.bigint,
    },
    cache: true,
  },
  async ({ input, context }) => {
    const { poolAddress, chainId, blockNumber } = input;
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    return await fetchDynamicFeeConfig(
      poolAddress,
      chainId,
      blockNumber,
      ethClient,
      context.log,
    );
  },
);

export const getCurrentFee = experimental_createEffect(
  {
    name: "getCurrentFee",
    input: {
      poolAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    output: S.bigint,
    cache: true,
  },
  async ({ input, context }) => {
    const { poolAddress, chainId, blockNumber } = input;
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    return await fetchCurrentFee(
      poolAddress,
      chainId,
      blockNumber,
      ethClient,
      context.log,
    );
  },
);

export const getCurrentAccumulatedFeeCL = experimental_createEffect(
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
    cache: true,
  },
  async ({ input, context }) => {
    const { poolAddress, chainId, blockNumber } = input;
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    return await fetchCurrentAccumulatedFeeCL(
      poolAddress,
      chainId,
      blockNumber,
      ethClient,
      context.log,
    );
  },
);
