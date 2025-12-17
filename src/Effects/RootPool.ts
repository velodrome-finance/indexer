import { createEffect } from "envio";
import { S } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import {
  CHAIN_CONSTANTS,
  EFFECT_RATE_LIMITS,
  toChecksumAddress,
} from "../Constants";

export async function fetchRootPoolAddress(
  ethClient: PublicClient,
  lpHelperAddress: string,
  factory: string,
  token0: string,
  token1: string,
  type: number,
  logger: Envio_logger,
): Promise<string> {
  const lpHelperABI = require("../../abis/LpHelper.json");

  const { result } = await ethClient.simulateContract({
    address: lpHelperAddress as `0x${string}`,
    abi: lpHelperABI,
    functionName: "root_lp_address",
    args: [factory, token0, token1, type],
  });

  // viem returns the address as a string (lowercase, no padding), handle both array and direct string returns
  const address = Array.isArray(result) ? result[0] : result;

  // Handle null/undefined results
  if (!address) {
    logger.error(
      "[fetchRootPoolAddress] No root pool address found. Returning empty address",
    );
    return "";
  }

  // Normalize to checksum format
  return toChecksumAddress(address.toString());
}

/**
 * Effect to get root pool address of a leaf pool
 */
export const getRootPoolAddress = createEffect(
  {
    name: "getRootPoolAddress",
    input: {
      chainId: S.number,
      factory: S.string,
      token0: S.string,
      token1: S.string,
      type: S.number,
    },
    output: S.string,
    rateLimit: {
      calls: EFFECT_RATE_LIMITS.ROOT_POOL_EFFECTS,
      per: "second",
    },
    cache: true,
  },
  async ({ input, context }) => {
    const { chainId, factory, token0, token1, type } = input;
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    const lpHelperAddress = CHAIN_CONSTANTS[chainId].lpHelperAddress;
    return fetchRootPoolAddress(
      ethClient,
      lpHelperAddress,
      factory,
      token0,
      token1,
      type,
      context.log,
    );
  },
);
