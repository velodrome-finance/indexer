import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import DYNAMIC_FEE_ABI from "../../abis/DynamicFeeSwapModule.json";
import { CHAIN_CONSTANTS, EFFECT_RATE_LIMITS } from "../Constants";
import { handleEffectErrorReturn } from "./Helpers";

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
  logger.info(
    `[fetchCurrentFee] Fetching current fee for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}`,
  );

  const { result } = await ethClient.simulateContract({
    address: dynamicFeeModuleAddress as `0x${string}`,
    abi: DYNAMIC_FEE_ABI,
    functionName: "getFee",
    args: [poolAddress],
    blockNumber: BigInt(blockNumber),
  });

  logger.info(`[fetchCurrentFee] Current fee fetched: ${result}`);
  // viem returns bigint for uint256, ensure it's a bigint
  return typeof result === "bigint" ? result : BigInt(String(result));
}

/**
 * Effect to get current fee from dynamic fee module
 *
 * Error handling: Returns undefined on failure. Callers should check for undefined
 * and handle appropriately (e.g., skip update or use existing fee).
 */
export const getCurrentFee = createEffect(
  {
    name: "getCurrentFee",
    input: {
      poolAddress: S.string,
      dynamicFeeModuleAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    output: S.nullable(S.bigint),
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
      // Return undefined on error - callers should check and handle appropriately
      return handleEffectErrorReturn(
        error,
        context,
        "getCurrentFee",
        {
          poolAddress,
          chainId,
          blockNumber,
        },
        undefined,
      );
    }
  },
);
