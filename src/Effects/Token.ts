import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import SpotPriceAggregatorABI from "../../abis/SpotPriceAggregator.json";
import PriceOracleABI from "../../abis/VeloPriceOracleABI.json";
import {
  CHAIN_CONSTANTS,
  EFFECT_RATE_LIMITS,
  PriceOracleType,
} from "../Constants";
import { createFallbackClient, shouldUseFallbackRPC } from "./Errors";
import { ErrorType, getErrorType, sleep } from "./Helpers";

// ERC20 Contract ABI
const contractABI = require("../../abis/ERC20.json");

/**
 * Core logic for fetching ERC20 token details
 * This can be tested independently of the Effect API
 */
export async function fetchTokenDetails(
  contractAddress: string,
  chainId: number,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<{ name: string; decimals: number; symbol: string }> {
  try {
    const [nameResult, decimalsResult, symbolResult] = await Promise.all([
      ethClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: contractABI,
        functionName: "name",
        args: [],
      }),
      ethClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: contractABI,
        functionName: "decimals",
        args: [],
      }),
      ethClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: contractABI,
        functionName: "symbol",
        args: [],
      }),
    ]);

    const result = {
      name: nameResult.result?.toString() || "",
      decimals: Number(decimalsResult.result) || 0,
      symbol: symbolResult.result?.toString() || "",
    };

    logger.info(
      `[fetchTokenDetails] Token details fetched: name=${result.name}, decimals=${result.decimals}, symbol=${result.symbol}`,
    );

    return result;
  } catch (error) {
    logger.error(
      `[fetchTokenDetails] Error fetching token details for address: ${contractAddress}`,
      error instanceof Error ? error : new Error(String(error)),
    );
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
  gasLimit = 10000000n, // 10M default - updated to reduce out-of-gas retries
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
        priceOracleType: priceOracleType, // Use the determined oracle type, not hardcoded V2
      };
    } catch (error) {
      const attemptDuration = Date.now() - attemptStartTime;
      const overallDuration = Date.now() - overallStartTime;
      const errorType = getErrorType(error);

      // Log slow failed attempts
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

      // Check if it's an out of gas error and we have retries left
      if (errorType === ErrorType.OUT_OF_GAS && attempt < maxRetries) {
        // Increase gas limit exponentially: 10M -> 20M -> 30M (max)
        // Max set to 30M to avoid hitting RPC provider limits (typically 30-50M)
        currentGasLimit = BigInt(
          Math.min(Number(currentGasLimit) * 2, 30000000),
        );
        attempt++;

        logger.warn(
          `[fetchTokenPrice] Out of gas error (attempt ${attempt}/${maxRetries + 1}) for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. Retrying with gas limit ${currentGasLimit}...`,
        );

        continue;
      }

      // Check if it's a rate limit error and we have retries left
      if (errorType === ErrorType.RATE_LIMIT && attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 10s, 30s, 60s
        let delayMs: number;
        if (attempt === 5) {
          delayMs = 30000; // 30 seconds for 6th retry
        } else if (attempt === 6) {
          delayMs = 60000; // 60 seconds (1 minute) for 7th retry
        } else {
          delayMs = Math.min(1000 * 2 ** attempt, 10000); // Exponential backoff up to 10s
        }
        attempt++;

        logger.warn(
          `[fetchTokenPrice] Rate limit error (attempt ${attempt}/${maxRetries + 1}) for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. Retrying in ${delayMs}ms...`,
        );

        await sleep(delayMs);
        continue;
      }

      // Check if it's a network error and we have retries left
      // Network errors use shorter backoff than rate limits since they're often transient
      if (errorType === ErrorType.NETWORK_ERROR && attempt < maxRetries) {
        // Shorter exponential backoff for network errors: 500ms, 1s, 2s, 4s, 8s, 15s, 30s
        let delayMs: number;
        if (attempt === 5) {
          delayMs = 15000; // 15 seconds for 6th retry
        } else if (attempt === 6) {
          delayMs = 30000; // 30 seconds for 7th retry
        } else {
          delayMs = Math.min(500 * 2 ** attempt, 8000); // Exponential backoff up to 8s
        }
        attempt++;

        logger.warn(
          `[fetchTokenPrice] Network error (attempt ${attempt}/${maxRetries + 1}) for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. Retrying in ${delayMs}ms...`,
        );

        await sleep(delayMs);
        continue;
      }

      // If it's a contract revert, check if it's due to historical state unavailability
      if (errorType === ErrorType.CONTRACT_REVERT) {
        // Check if error is due to historical state unavailability
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const isHistoricalStateError =
          errorMessage.includes("historical state");

        if (isHistoricalStateError) {
          logger.warn(
            `[fetchTokenPrice] Historical state not available for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. This is an RPC limitation, not a contract revert. Returning zero price - caller should use last known price if available.`,
          );
        } else {
          logger.warn(
            `[fetchTokenPrice] Contract reverted for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. This usually means no price path exists. Returning zero price.`,
          );
        }
        break;
      }

      // If not a retryable error or no retries left, log and break
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

  // Return zero price on error to prevent processing failures
  return {
    pricePerUSDNew: 0n,
    priceOracleType: priceOracleType,
  };
}

/**
 * Core logic for fetching sqrtPriceX96 from pool's slot0 function
 * Includes fallback to public RPC when private RPC fails with historical state errors
 */
export async function fetchSqrtPriceX96(
  poolAddress: string,
  chainId: number,
  blockNumber: number,
  ethClient: PublicClient,
  logger: Envio_logger,
): Promise<bigint> {
  const CLPoolABI = require("../../abis/CLPool.json");

  const attemptFetch = async (client: PublicClient, isFallback = false) => {
    const { result } = await client.simulateContract({
      address: poolAddress as `0x${string}`,
      abi: CLPoolABI,
      functionName: "slot0",
      args: [],
      blockNumber: BigInt(blockNumber),
    });
    return result;
  };

  try {
    const result = await attemptFetch(ethClient);

    // Handle both array and tuple object returns from viem
    // When ABI has named fields, viem returns an object; otherwise it returns an array
    let sqrtPriceX96: bigint;
    if (Array.isArray(result)) {
      sqrtPriceX96 = result[0] as bigint;
    } else if (result && typeof result === "object") {
      // Try accessing as object with named property
      if ("sqrtPriceX96" in result) {
        sqrtPriceX96 = (result as { sqrtPriceX96: bigint }).sqrtPriceX96;
      } else if (result[0] !== undefined) {
        // Sometimes viem returns object-like array
        sqrtPriceX96 = result[0] as bigint;
      } else {
        // Helper to stringify with BigInt support
        const stringifyResult = (obj: unknown): string => {
          if (Array.isArray(obj)) {
            return `[${obj
              .map((item) =>
                typeof item === "bigint" ? item.toString() : String(item),
              )
              .join(", ")}]`;
          }
          if (obj && typeof obj === "object") {
            const entries = Object.entries(obj).map(
              ([key, value]) =>
                `${key}: ${typeof value === "bigint" ? value.toString() : String(value)}`,
            );
            return `{${entries.join(", ")}}`;
          }
          return String(obj);
        };

        logger.error(
          `[fetchSqrtPriceX96] Unexpected result format. Result type: ${typeof result}, keys: ${result && typeof result === "object" ? Object.keys(result).join(", ") : "N/A"}, result: ${stringifyResult(result)}`,
        );
        throw new Error(
          `Unexpected result format from slot0. Expected array or object with sqrtPriceX96 property, got: ${stringifyResult(result)}`,
        );
      }
    } else {
      logger.error(
        `[fetchSqrtPriceX96] Result is not array or object. Type: ${typeof result}, value: ${String(result)}`,
      );
      throw new Error(
        `Unexpected result type from slot0: ${typeof result}, value: ${String(result)}`,
      );
    }
    return sqrtPriceX96;
  } catch (error) {
    // If error should trigger fallback (historical state, temporary errors, etc.), try fallback public RPC
    const shouldFallback = shouldUseFallbackRPC(error);
    if (shouldFallback) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorType =
        errorMessage.includes("state histories") ||
        errorMessage.includes("historical state")
          ? "historical state not available"
          : errorMessage.includes("Temporary internal error")
            ? "temporary RPC error"
            : "RPC error";

      logger.warn(
        `[fetchSqrtPriceX96] ${errorType} on primary RPC for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}. Attempting fallback to public RPC...`,
      );

      const fallbackClient = createFallbackClient(chainId);
      if (fallbackClient) {
        try {
          const result = await attemptFetch(fallbackClient, true);

          // Handle both array and tuple object returns from viem
          let sqrtPriceX96: bigint;
          if (Array.isArray(result)) {
            sqrtPriceX96 = result[0] as bigint;
          } else if (result && typeof result === "object") {
            if ("sqrtPriceX96" in result) {
              sqrtPriceX96 = (result as { sqrtPriceX96: bigint }).sqrtPriceX96;
            } else if (result[0] !== undefined) {
              sqrtPriceX96 = result[0] as bigint;
            } else {
              throw new Error("Unexpected result format from fallback RPC");
            }
          } else {
            throw new Error("Unexpected result type from fallback RPC");
          }

          return sqrtPriceX96;
        } catch (fallbackError) {
          logger.error(
            `[fetchSqrtPriceX96] Fallback RPC also failed for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}`,
            fallbackError instanceof Error
              ? fallbackError
              : new Error(String(fallbackError)),
          );
          // Fall through to throw the original error
        }
      } else {
        logger.warn(
          `[fetchSqrtPriceX96] No fallback RPC available for chain ${chainId}`,
        );
      }
    }

    // Create a more readable error message
    const errorMessage = error instanceof Error ? error.message : String(error);
    const readableError = new Error(
      `Failed to fetch sqrtPriceX96 from pool ${poolAddress} on chain ${chainId} at block ${blockNumber}: ${errorMessage}`,
    );

    // Preserve stack trace if available
    if (error instanceof Error && error.stack) {
      readableError.stack = error.stack;
    }

    logger.error(`[fetchSqrtPriceX96] ${readableError.message}`, readableError);
    throw readableError;
  }
}

/**
 * Effect to get ERC20 token details (name, decimals, symbol)
 * This replaces the direct RPC calls in getErc20TokenDetails
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
      return await fetchTokenDetails(
        contractAddress,
        chainId,
        ethClient,
        context.log,
      );
    } catch (error) {
      // Don't cache failed response
      context.cache = false;
      context.log.error(
        `[getTokenDetails] Error in effect for ${contractAddress} on chain ${chainId}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      // Return default values on error to prevent processing failures
      return {
        name: "",
        decimals: 0,
        symbol: "",
      };
    }
  },
);

/**
 * Effect to read prices from price oracle contracts
 * This replaces the direct RPC calls in read_prices
 */
export const getTokenPrice = createEffect(
  {
    name: "getTokenPrice",
    input: {
      tokenAddress: S.string,
      usdcAddress: S.string,
      systemTokenAddress: S.string,
      wethAddress: S.string,
      connectors: S.array(S.string),
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
    cache: true, // Price data is not cached for the update interval
  },
  async ({ input, context }) => {
    const {
      tokenAddress,
      usdcAddress,
      systemTokenAddress,
      wethAddress,
      connectors,
      chainId,
      blockNumber,
      gasLimit = 10000000n,
    } = input;

    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    const effectStartTime = Date.now();
    try {
      const result = await fetchTokenPrice(
        tokenAddress,
        usdcAddress,
        systemTokenAddress,
        wethAddress,
        connectors,
        chainId,
        blockNumber,
        ethClient,
        context.log,
        gasLimit,
      );

      const effectDuration = Date.now() - effectStartTime;
      if (effectDuration > 5000) {
        context.log.warn(
          `[getTokenPrice] Effect took ${effectDuration}ms for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}`,
        );
      }

      return result;
    } catch (error) {
      const effectDuration = Date.now() - effectStartTime;
      // Don't cache failed response
      context.cache = false;
      context.log.error(
        `[getTokenPrice] Error in effect for ${tokenAddress} on chain ${chainId} at block ${blockNumber} (duration: ${effectDuration}ms):`,
        error instanceof Error ? error : new Error(String(error)),
      );
      // Return zero price on error to prevent processing failures
      return {
        pricePerUSDNew: 0n,
        priceOracleType: CHAIN_CONSTANTS[chainId].oracle
          .getType(blockNumber)
          .toString(),
      };
    }
  },
);

/**
 * Effect to get complete token price data including token details and price
 * This combines token details fetching with price fetching for efficiency
 */
export const getTokenPriceData = createEffect(
  {
    name: "getTokenPriceData",
    input: {
      tokenAddress: S.string,
      blockNumber: S.number,
      chainId: S.number,
      gasLimit: S.optional(S.bigint),
    },
    output: {
      pricePerUSDNew: S.bigint,
      decimals: S.bigint,
    },
    rateLimit: {
      calls: EFFECT_RATE_LIMITS.TOKEN_EFFECTS,
      per: "second",
    },
    cache: false, // The underlying effects that are called inside this effect are already cached
  },
  async ({ input, context }) => {
    const { tokenAddress, blockNumber, chainId, gasLimit = 10000000n } = input;

    try {
      // Get chain constants first (synchronous)
      const WETH_ADDRESS = CHAIN_CONSTANTS[chainId].weth;
      const USDC_ADDRESS = CHAIN_CONSTANTS[chainId].usdc;
      const SYSTEM_TOKEN_ADDRESS =
        CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

      // If it's USDC, only fetch token details and return early
      if (tokenAddress === USDC_ADDRESS) {
        const tokenDetails = await context.effect(getTokenDetails, {
          contractAddress: tokenAddress,
          chainId,
        });
        const result = {
          pricePerUSDNew: 10n ** 18n, // TEN_TO_THE_18_BI
          decimals: BigInt(tokenDetails.decimals),
        };
      }

      // For non-USDC tokens, fetch both token details in parallel for better performance
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

      const connectors = CHAIN_CONSTANTS[chainId].oracle.priceConnectors
        .filter((connector) => connector.createdBlock <= blockNumber)
        .map((connector) => connector.address)
        .filter((connector) => connector !== tokenAddress)
        .filter((connector) => connector !== WETH_ADDRESS)
        .filter((connector) => connector !== USDC_ADDRESS)
        .filter((connector) => connector !== SYSTEM_TOKEN_ADDRESS);

      const ORACLE_DEPLOYED =
        CHAIN_CONSTANTS[chainId].oracle.startBlock <= blockNumber;

      if (ORACLE_DEPLOYED) {
        const priceData = await context.effect(getTokenPrice, {
          tokenAddress,
          usdcAddress: USDC_ADDRESS,
          systemTokenAddress: SYSTEM_TOKEN_ADDRESS,
          wethAddress: WETH_ADDRESS,
          connectors,
          chainId,
          blockNumber,
          gasLimit,
        });

        let pricePerUSDNew = 0n;
        if (priceData.priceOracleType === PriceOracleType.V3) {
          // Convert to 18 decimals
          pricePerUSDNew =
            (priceData.pricePerUSDNew * 10n ** BigInt(tokenDetails.decimals)) /
            10n ** BigInt(USDTokenDetails.decimals);
        } else {
          pricePerUSDNew = priceData.pricePerUSDNew;
        }

        // If price is 0, it means no price path exists in the oracle
        // This is different from an error - the call succeeded but returned 0
        if (pricePerUSDNew === 0n) {
          context.log.warn(
            `[getTokenPriceData] Oracle returned 0 price for ${tokenAddress} on chain ${chainId} at block ${blockNumber}. This means no price path exists. The caller should use last known price if available.`,
          );
        }

        const result = {
          pricePerUSDNew,
          decimals: BigInt(tokenDetails.decimals),
        };

        context.log.info(
          `[getTokenPriceData] Successfully fetched price data for ${tokenAddress} on chain ${chainId} at block ${blockNumber}. Price: ${result.pricePerUSDNew}, Decimals: ${result.decimals}. Oracle type: ${priceData.priceOracleType}`,
        );

        return result;
      }

      const result = {
        pricePerUSDNew: 0n,
        decimals: BigInt(tokenDetails.decimals),
      };

      context.log.info(
        `[getTokenPriceData] Oracle not deployed, returning zero price for ${tokenAddress} on chain ${chainId} at block ${blockNumber}`,
      );

      return result;
    } catch (error) {
      // Don't cache failed response
      context.cache = false;
      context.log.error(
        `[getTokenPriceData] Error fetching token price data for ${tokenAddress} on chain ${chainId} at block ${blockNumber}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        pricePerUSDNew: 0n,
        decimals: 0n,
      };
    }
  },
);

/**
 * Effect to get sqrtPriceX96 from CLPool's slot0 function
 * This replaces direct RPC calls for fetching current pool price
 * Used for calculating position amounts from liquidity in concentrated liquidity pools
 */
export const getSqrtPriceX96 = createEffect(
  {
    name: "getSqrtPriceX96",
    input: {
      poolAddress: S.string,
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
    const { poolAddress, chainId, blockNumber } = input;
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    try {
      const result = await fetchSqrtPriceX96(
        poolAddress,
        chainId,
        blockNumber,
        ethClient,
        context.log,
      );
      return result;
    } catch (error) {
      context.cache = false;

      // Create a more readable error message
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const readableError = new Error(
        `getSqrtPriceX96 effect failed for pool ${poolAddress} on chain ${chainId} at block ${blockNumber}: ${errorMessage}`,
      );

      // Preserve stack trace if available
      if (error instanceof Error && error.stack) {
        readableError.stack = error.stack;
      }

      context.log.error(
        `[getSqrtPriceX96] ${readableError.message}`,
        readableError,
      );
      throw readableError;
    }
  },
);
