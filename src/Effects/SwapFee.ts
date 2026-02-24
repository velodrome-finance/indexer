import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import CL_FACTORY_ABI from "../../abis/CLFactory.json";
import { CHAIN_CONSTANTS, EFFECT_RATE_LIMITS } from "../Constants";
import { handleEffectErrorReturn } from "./Helpers";

/**
 * Core logic for fetching current swap fee from the CLFactory that created the pool.
 * This can be tested independently of the Effect API.
 */
export async function fetchSwapFee(
  poolAddress: string,
  factoryAddress: string,
  chainId: number,
  blockNumber: number,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<bigint> {
  logger.info(
    `[fetchSwapFee] Fetching swap fee for pool ${poolAddress} from factory ${factoryAddress} on chain ${chainId} at block ${blockNumber}`,
  );

  const result = await ethClient.readContract({
    address: factoryAddress as `0x${string}`,
    abi: CL_FACTORY_ABI,
    functionName: "getSwapFee",
    args: [poolAddress as `0x${string}`],
    blockNumber: BigInt(blockNumber),
  });

  // CLFactory.getSwapFee returns uint24; ensure it's a bigint
  return typeof result === "bigint" ? result : BigInt(String(result));
}

/**
 * Effect to get swap fee from the factory that created the pool (e.g. CLFactory.getSwapFee).
 *
 * Error handling: Returns undefined on failure. Callers should check for undefined
 * and handle appropriately (e.g., skip update or use existing fee).
 */
export const getSwapFee = createEffect(
  {
    name: "getSwapFee",
    input: {
      poolAddress: S.string,
      factoryAddress: S.string,
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
    const { poolAddress, factoryAddress, chainId, blockNumber } = input;
    try {
      const chainConfig = CHAIN_CONSTANTS[chainId];
      if (!chainConfig?.eth_client) {
        throw new Error(`No eth_client configured for chainId ${chainId}`);
      }
      const ethClient = chainConfig.eth_client;
      const result = await fetchSwapFee(
        poolAddress,
        factoryAddress,
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
        "getSwapFee",
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
