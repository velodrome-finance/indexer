import { S, createEffect } from "envio";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import SpotPriceAggregatorABI from "../../abis/SpotPriceAggregator.json";
import PriceOracleABI from "../../abis/VeloPriceOracleABI.json";
import { CHAIN_CONSTANTS, PriceOracleType } from "../Constants";
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
    logger.info(
      `[fetchTokenDetails] Fetching token details for address: ${contractAddress}`,
    );

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
  gasLimit = 1000000n,
  maxRetries = 7,
): Promise<{ pricePerUSDNew: bigint; priceOracleType: string }> {
  const priceOracleType = CHAIN_CONSTANTS[chainId].oracle.getType(blockNumber);
  const priceOracleAddress =
    CHAIN_CONSTANTS[chainId].oracle.getAddress(priceOracleType);

  logger.info(
    `[fetchTokenPrice] Fetching price for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}`,
  );

  let attempt = 0;
  let currentGasLimit = gasLimit;

  while (attempt <= maxRetries) {
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

      return {
        pricePerUSDNew: BigInt(result[0]),
        priceOracleType: PriceOracleType.V2,
      };
    } catch (error) {
      const errorType = getErrorType(error);

      // Check if it's an out of gas error and we have retries left
      if (errorType === ErrorType.OUT_OF_GAS && attempt < maxRetries) {
        // Increase gas limit exponentially: 1M -> 2M -> 4M -> 8M -> 16M (max)
        currentGasLimit = BigInt(
          Math.min(Number(currentGasLimit) * 2, 16000000),
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

      // If it's a contract revert, log it specifically (no retries needed)
      if (errorType === ErrorType.CONTRACT_REVERT) {
        logger.warn(
          `[fetchTokenPrice] Contract reverted for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}. This usually means no price path exists. Returning zero price.`,
        );
        break;
      }

      // If not a retryable error or no retries left, log and break
      logger.error(
        `[fetchTokenPrice] Error fetching price for token ${tokenAddress} on chain ${chainId} at block ${blockNumber}${attempt > 0 ? ` (after ${attempt} retries)` : ""}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      break;
    }
  }

  // Return zero price on error to prevent processing failures
  return {
    pricePerUSDNew: 0n,
    priceOracleType: PriceOracleType.V2,
  };
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
      calls: 20,
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
      calls: 10,
      per: "second",
    },
    cache: true, // Price data can be cached for the update interval
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
      gasLimit = 1000000n,
    } = input;

    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    try {
      return await fetchTokenPrice(
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
    } catch (error) {
      // Don't cache failed response
      context.cache = false;
      context.log.error(
        `[getTokenPrice] Error in effect for ${tokenAddress} on chain ${chainId} at block ${blockNumber}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      // Return zero price on error to prevent processing failures
      return {
        pricePerUSDNew: 0n,
        priceOracleType: PriceOracleType.V2,
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
      calls: 10,
      per: "second",
    },
    cache: true, // Combined price data can be cached
  },
  async ({ input, context }) => {
    const { tokenAddress, blockNumber, chainId, gasLimit = 1000000n } = input;

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
        return {
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

        return {
          pricePerUSDNew,
          decimals: BigInt(tokenDetails.decimals),
        };
      }

      context.log.error(
        `[getTokenPriceData] ORACLE_NOT_DEPLOYED for ${tokenAddress} on chain ${chainId} at block ${blockNumber}`,
      );

      return {
        pricePerUSDNew: 0n,
        decimals: BigInt(tokenDetails.decimals),
      };
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
