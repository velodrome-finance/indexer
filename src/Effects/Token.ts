import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import CLPOOL_ABI from "../../abis/CLPool.json";
import ERC20_ABI from "../../abis/ERC20.json";
import SpotPriceAggregatorABI from "../../abis/SpotPriceAggregator.json";
import PriceOracleABI from "../../abis/VeloPriceOracleABI.json";
import {
  CHAIN_CONSTANTS,
  EFFECT_RATE_LIMITS,
  PriceOracleType,
} from "../Constants";
import {
  ErrorType,
  getErrorType,
  handleEffectErrorReturn,
  sleep,
} from "./Helpers";

/**
 * Core logic for fetching ERC20 token details
 * This can be tested independently of the Effect API
 */
export async function fetchTokenDetails(
  contractAddress: string,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<{ name: string; decimals: number; symbol: string }> {
  try {
    const [nameResult, decimalsResult, symbolResult] = await Promise.all([
      ethClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "name",
        args: [],
      }),
      ethClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
        args: [],
      }),
      ethClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "symbol",
        args: [],
      }),
    ]);

    const result = {
      name: (nameResult.result as unknown)?.toString() || "",
      decimals: Number(decimalsResult.result) || 0,
      symbol: (symbolResult.result as unknown)?.toString() || "",
    };

    logger.info(
      `[fetchTokenDetails] Token details fetched: name=${result.name}, decimals=${result.decimals}, symbol=${result.symbol}`,
    );

    return result;
  } catch (error) {
    // Return default values on error to prevent processing failures
    return {
      name: "",
      decimals: 0,
      symbol: "",
    };
  }
}

/**
 * Core logic for fetching token prices from price oracle contracts
 * This can be tested independently of the Effect API
 * Includes retry logic with exponential backoff for rate limit errors
 * Includes fallback RPC support for network and historical state errors
 */
export async function fetchTokenPrice(
  tokenAddress: string,
  usdcAddress: string,
  systemTokenAddress: string,
  wethAddress: string,
  connectors: string[],
  chainId: number,
  blockNumber: number,
  ethClient: PublicClient,
  logger: Envio_logger,
  gasLimit: bigint,
  maxRetries = 7,
): Promise<{ pricePerUSDNew: bigint; priceOracleType: string }> {
  const overallStartTime = Date.now();
  const priceOracleType = CHAIN_CONSTANTS[chainId].oracle.getType(blockNumber);
  const priceOracleAddress =
    CHAIN_CONSTANTS[chainId].oracle.getAddress(priceOracleType);

  let attempt = 0;
  let currentGasLimit = gasLimit;

  while (attempt <= maxRetries) {
    const attemptStartTime = Date.now();
    try {
      if (priceOracleType === PriceOracleType.V3) {
        const tokenAddressArray = [
          ...connectors,
          systemTokenAddress,
          wethAddress,
          usdcAddress,
        ];
        const args = [
          [tokenAddress],
          usdcAddress,
          false,
          tokenAddressArray,
          10,
        ];
        const { result } = await ethClient.simulateContract({
          address: priceOracleAddress as `0x${string}`,
          abi: SpotPriceAggregatorABI,
          functionName: "getManyRatesWithCustomConnectors",
          args,
          blockNumber: BigInt(blockNumber),
          gas: currentGasLimit,
        });
        const attemptDuration = Date.now() - attemptStartTime;
        const overallDuration = Date.now() - overallStartTime;

        if (attemptDuration > 5000) {
          logger.warn(
            `[fetchTokenPrice] Slow request detected: ${attemptDuration}ms for token ${tokenAddress} on chain ${chainId} at block ${blockNumber} (attempt ${attempt + 1}, total duration: ${overallDuration}ms)`,
          );
        }

        if (overallDuration > 30000) {
          logger.error(
            `[fetchTokenPrice] Very slow request: ${overallDuration}ms total for token ${tokenAddress} on chain ${chainId} at block ${blockNumber} (attempt ${attempt + 1})`,
          );
        }

        return {
          pricePerUSDNew: BigInt(result[0]),
          priceOracleType: PriceOracleType.V3,
        };
      }

      const tokenAddressArray = [
        tokenAddress,
        ...connectors,
        systemTokenAddress,
        wethAddress,
        usdcAddress,
      ];
      const args = [1, tokenAddressArray];
      const { result } = await ethClient.simulateContract({
        address: priceOracleAddress as `0x${string}`,
        abi: PriceOracleABI,
        functionName: "getManyRatesWithConnectors",
        args,
        blockNumber: BigInt(blockNumber),
        gas: currentGasLimit,
      });
      const attemptDuration = Date.now() - attemptStartTime;
      const overallDuration = Date.now() - overallStartTime;

      if (attemptDuration > 5000) {
        logger.warn(
          `[fetchTokenPrice] Slow request detected: ${attemptDuration}ms for token ${tokenAddress} on chain ${chainId} at block ${blockNumber} (attempt ${attempt + 1}, total duration: ${overallDuration}ms)`,
        );
      }

      if (overallDuration > 30000) {
        logger.error(
          `[fetchTokenPrice] Very slow request: ${overallDuration}ms total for token ${tokenAddress} on chain ${chainId} at block ${blockNumber} (attempt ${attempt + 1})`,
        );
      }

      return {
        pricePerUSDNew: BigInt(result[0]),
        priceOracleType: priceOracleType,
      };
    } catch (error) {
      const attemptDuration = Date.now() - attemptStartTime;
      const overallDuration = Date.now() - overallStartTime;
      const errorType = getErrorType(error);

      if (attemptDuration > 5000) {
        logger.warn(
          `[fetchTokenPrice] Slow failed request: ${attemptDuration}ms for token ${tokenAddress} on chain ${chainId} at block ${blockNumber} (attempt ${attempt + 1}, error type: ${errorType}, total duration: ${overallDuration}ms)`,
        );
      }

      if (overallDuration > 30000) {
        logger.error(
          `[fetchTokenPrice] Very slow failed request: ${overallDuration}ms total for token ${tokenAddress} on chain ${chainId} at block ${blockNumber} (attempt ${attempt + 1}, error type: ${errorType})`,
        );
      }

      if (errorType === ErrorType.OUT_OF_GAS && attempt < maxRetries) {
        currentGasLimit = BigInt(
          Math.min(Number(currentGasLimit) * 2, 30000000),
        );
        attempt++;
        logger.warn(
          `[fetchTokenPrice] Out of gas error (attempt ${attempt}/${maxRetries + 1}) for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. Retrying with gas limit ${currentGasLimit}...`,
        );
        continue;
      }

      if (errorType === ErrorType.RATE_LIMIT && attempt < maxRetries) {
        let delayMs: number;
        if (attempt === 5) delayMs = 30000;
        else if (attempt === 6) delayMs = 60000;
        else delayMs = Math.min(1000 * 2 ** attempt, 10000);
        attempt++;
        logger.warn(
          `[fetchTokenPrice] Rate limit error (attempt ${attempt}/${maxRetries + 1}) for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. Retrying in ${delayMs}ms...`,
        );
        await sleep(delayMs);
        continue;
      }

      if (errorType === ErrorType.NETWORK_ERROR && attempt < maxRetries) {
        let delayMs: number;
        if (attempt === 5) delayMs = 15000;
        else if (attempt === 6) delayMs = 30000;
        else delayMs = Math.min(500 * 2 ** attempt, 8000);
        attempt++;
        logger.warn(
          `[fetchTokenPrice] Network error (attempt ${attempt}/${maxRetries + 1}) for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. Retrying in ${delayMs}ms...`,
        );
        await sleep(delayMs);
        continue;
      }

      logger.error(
        `[fetchTokenPrice] Error fetching price for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}${attempt > 0 ? ` (after ${attempt} retries)` : ""} (error type: ${errorType}):`,
        error instanceof Error ? error : new Error(String(error)),
      );
      break;
    }
  }

  const finalDuration = Date.now() - overallStartTime;
  if (finalDuration > 30000) {
    logger.error(
      `[fetchTokenPrice] Request failed after ${finalDuration}ms total for token ${tokenAddress} on chain ${chainId} at block ${blockNumber} (${attempt} attempts). Returning zero price.`,
    );
  }

  return {
    pricePerUSDNew: 0n,
    priceOracleType: priceOracleType,
  };
}

/**
 * Helper function to round block number to nearest hour interval for better cache hits
 * Uses approximate block times: 2s for most L2s, 12s for Ethereum mainnet
 * Exported so callers can round blockNumber before passing to getTokenPrice effect
 * (cache key is based on input parameters, so rounding must happen before the effect call)
 */
export function roundBlockToInterval(
  blockNumber: number,
  chainId: number,
): number {
  // Approximate block times per chain (in seconds)
  // Most L2s (Base, Optimism, Mode, etc.) are ~2 seconds
  // Ethereum mainnet is ~12 seconds
  const blockTimeSeconds = chainId === 1 ? 12 : 2;
  const blocksPerHour = Math.floor(3600 / blockTimeSeconds);
  return Math.floor(blockNumber / blocksPerHour) * blocksPerHour;
}

/**
 * Effect to get ERC20 token details (name, decimals, symbol)
 * This replaces the direct RPC calls in getErc20TokenDetails
 *
 * Error handling: Returns default values ({ name: "", decimals: 0, symbol: "" }) on error
 * to allow the indexer to continue processing even if token details can't be fetched.
 */
export const getTokenDetails = createEffect(
  {
    name: "getTokenDetails",
    input: {
      contractAddress: S.string,
      chainId: S.number,
    },
    output: {
      name: S.string,
      decimals: S.number,
      symbol: S.string,
    },
    rateLimit: {
      calls: EFFECT_RATE_LIMITS.TOKEN_EFFECTS,
      per: "second",
    },
    cache: true, // Token details rarely change, perfect for caching
  },
  async ({ input, context }) => {
    const { contractAddress, chainId } = input;
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    try {
      return await fetchTokenDetails(contractAddress, ethClient, context.log);
    } catch (error) {
      // Return default values on error to prevent processing failures
      // This allows the indexer to continue even if token details can't be fetched
      return handleEffectErrorReturn(
        error,
        context,
        "getTokenDetails",
        { contractAddress, chainId },
        {
          name: "",
          decimals: 0,
          symbol: "",
        },
      );
    }
  },
);

/**
 * Effect to read prices from price oracle contracts
 * Handles block rounding, connector building, USDC special case, and V3 decimal conversion
 * This is the main entry point for fetching token prices - all other functions should call this
 *
 * Error handling: Returns zero price (0n) on error to allow the indexer to continue processing
 * even if price can't be fetched. Callers should check for zero prices and handle appropriately.
 */
export const getTokenPrice = createEffect(
  {
    name: "getTokenPrice",
    input: {
      tokenAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
      gasLimit: S.optional(S.bigint),
    },
    output: {
      pricePerUSDNew: S.bigint,
      priceOracleType: S.string,
    },
    rateLimit: {
      calls: EFFECT_RATE_LIMITS.TOKEN_EFFECTS,
      per: "second",
    },
    cache: true, // Cache enabled, block interval rounding improves hit rate
  },
  async ({ input, context }) => {
    const {
      tokenAddress,
      chainId,
      blockNumber,
      gasLimit = 10_000_000n,
    } = input;
    // Note: blockNumber should already be rounded by the caller for proper caching
    // Cache key is based on input parameters, so rounding must happen before effect call

    // Get chain constants
    const WETH_ADDRESS = CHAIN_CONSTANTS[chainId].weth;
    const USDC_ADDRESS = CHAIN_CONSTANTS[chainId].usdc;
    const SYSTEM_TOKEN_ADDRESS =
      CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

    // Handle USDC special case
    if (tokenAddress === USDC_ADDRESS) {
      return {
        pricePerUSDNew: 10n ** 18n, // TEN_TO_THE_18_BI
        priceOracleType: CHAIN_CONSTANTS[chainId].oracle
          .getType(blockNumber)
          .toString(),
      };
    }

    // Fetch token details for V3 oracle decimal conversion if needed
    const [tokenDetails, USDTokenDetails] = await Promise.all([
      context.effect(getTokenDetails, {
        contractAddress: tokenAddress,
        chainId,
      }),
      context.effect(getTokenDetails, {
        contractAddress: USDC_ADDRESS,
        chainId,
      }),
    ]);

    // Build connectors list
    const connectors = CHAIN_CONSTANTS[chainId].oracle.priceConnectors
      .filter((connector) => connector.createdBlock <= blockNumber)
      .map((connector) => connector.address)
      .filter((connector) => connector !== tokenAddress)
      .filter((connector) => connector !== WETH_ADDRESS)
      .filter((connector) => connector !== USDC_ADDRESS)
      .filter((connector) => connector !== SYSTEM_TOKEN_ADDRESS);

    const ORACLE_DEPLOYED =
      CHAIN_CONSTANTS[chainId].oracle.startBlock <= blockNumber;

    if (!ORACLE_DEPLOYED) {
      context.log.info(
        `[getTokenPrice] Oracle not deployed, returning zero price for ${tokenAddress} on chain ${chainId} at block ${blockNumber}`,
      );
      return {
        pricePerUSDNew: 0n,
        priceOracleType: CHAIN_CONSTANTS[chainId].oracle
          .getType(blockNumber)
          .toString(),
      };
    }

    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    const effectStartTime = Date.now();
    try {
      const priceData = await fetchTokenPrice(
        tokenAddress,
        USDC_ADDRESS,
        SYSTEM_TOKEN_ADDRESS,
        WETH_ADDRESS,
        connectors,
        chainId,
        blockNumber,
        ethClient,
        context.log,
        gasLimit,
      );

      // Convert V3 oracle prices to 18 decimals
      let currentPrice: bigint;
      if (priceData.priceOracleType === PriceOracleType.V3) {
        currentPrice =
          (priceData.pricePerUSDNew * 10n ** BigInt(tokenDetails.decimals)) /
          10n ** BigInt(USDTokenDetails.decimals);
      } else {
        currentPrice = priceData.pricePerUSDNew;
      }

      // Log warning if price is 0
      if (currentPrice === 0n) {
        context.log.warn(
          `[getTokenPrice] Oracle returned 0 price for ${tokenAddress} on chain ${chainId} at block ${blockNumber}. This means no price path exists.`,
        );
      }

      const effectDuration = Date.now() - effectStartTime;
      if (effectDuration > 5000) {
        context.log.warn(
          `[getTokenPrice] Effect took ${effectDuration}ms for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}`,
        );
      }

      return {
        pricePerUSDNew: currentPrice,
        priceOracleType: CHAIN_CONSTANTS[chainId].oracle
          .getType(blockNumber)
          .toString(),
      };
    } catch (error) {
      const effectDuration = Date.now() - effectStartTime;
      // Return zero price on error to prevent processing failures
      // This allows the indexer to continue even if price can't be fetched
      return handleEffectErrorReturn(
        error,
        context,
        "getTokenPrice",
        { tokenAddress, chainId, blockNumber, duration: `${effectDuration}ms` },
        {
          pricePerUSDNew: 0n,
          priceOracleType: CHAIN_CONSTANTS[chainId].oracle
            .getType(blockNumber)
            .toString(),
        },
      );
    }
  },
);
