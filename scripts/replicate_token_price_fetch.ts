/**
 * Script that exactly replicates what the indexer does for token price fetching
 *
 * This replicates the entire flow:
 * 1. refreshTokenPrice -> roundBlockToInterval
 * 2. getTokenPrice effect -> builds connectors, determines oracle type
 * 3. fetchTokenPrice -> calls simulateContract with exact parameters
 *
 * Usage:
 *   # Use default RPC and gas limit (10M)
 *   npx ts-node scripts/replicate_token_price_fetch.ts
 *
 *   # Use custom RPC URL
 *   ENVIO_OPTIMISM_RPC_URL="https://..." npx ts-node scripts/replicate_token_price_fetch.ts
 *
 *   # Test with 1M gas limit (to reproduce the error)
 *   GAS_LIMIT=1000000 npx ts-node scripts/replicate_token_price_fetch.ts
 *
 *   # Test with both custom RPC and gas limit
 *   ENVIO_OPTIMISM_RPC_URL="https://..." GAS_LIMIT=1000000 npx ts-node scripts/replicate_token_price_fetch.ts
 */

import dotenv from "dotenv";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { http, createPublicClient } from "viem";
import { optimism } from "viem/chains";
import { CHAIN_CONSTANTS } from "../src/Constants";
import { roundBlockToInterval } from "../src/Effects/Token";
import { fetchTokenPrice } from "../src/Effects/Token";

dotenv.config();

// RPC configuration
const RPC_URL = process.env.ENVIO_OPTIMISM_RPC_URL;

// Default gas limit (from getTokenPrice effect default)
const DEFAULT_GAS_LIMIT = 10000000n; // 10M

// Mock logger for fetchTokenPrice
const mockLogger: Envio_logger = {
  info: (...args: unknown[]) => console.log("[INFO]", ...args),
  warn: (...args: unknown[]) => console.warn("[WARN]", ...args),
  error: (...args: unknown[]) => console.error("[ERROR]", ...args),
  debug: (...args: unknown[]) => console.debug("[DEBUG]", ...args),
};

/**
 * Replicates the entire refreshTokenPrice -> getTokenPrice flow
 */
async function replicateTokenPriceFetch(
  tokenAddress: string,
  blockNumber: number,
  chainId: number,
  gasLimit?: bigint,
): Promise<void> {
  console.log("=== Replicating Indexer Token Price Fetch ===\n");
  console.log("Token Address:", tokenAddress);
  console.log("Original Block Number:", blockNumber);
  console.log("Chain ID:", chainId);
  console.log("RPC URL:", RPC_URL);

  // Step 1: Round block number (replicates roundBlockToInterval from refreshTokenPrice)
  const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);
  console.log("\n[Step 1] Block rounding:");
  console.log(`  Original: ${blockNumber}`);
  console.log(`  Rounded: ${roundedBlockNumber}`);

  // Step 2: Get chain constants
  const chainConstants = CHAIN_CONSTANTS[chainId];
  if (!chainConstants) {
    throw new Error(`Chain ID ${chainId} not supported`);
  }

  // Step 3: Check if oracle is deployed
  const oracleDeployed = chainConstants.oracle.startBlock <= roundedBlockNumber;
  if (!oracleDeployed) {
    console.log("\n[Step 2] Oracle not deployed at this block");
    return;
  }

  // Step 4: Determine oracle type
  const oracleType = chainConstants.oracle.getType(roundedBlockNumber);
  console.log("\n[Step 3] Oracle type:", oracleType);

  // Step 5: Handle USDC special case (replicates getTokenPrice effect)
  if (tokenAddress.toLowerCase() === chainConstants.usdc.toLowerCase()) {
    console.log("\n[Step 4] USDC special case - returning 1e18");
    console.log("Price: 1000000000000000000 (1e18)");
    return;
  }

  // Step 6: Build connectors (replicates getTokenPrice effect logic)
  const systemTokenAddress = chainConstants.rewardToken(roundedBlockNumber);
  const connectors = chainConstants.oracle.priceConnectors
    .filter((connector) => connector.createdBlock <= roundedBlockNumber)
    .map((connector) => connector.address)
    .filter((connector) => connector !== tokenAddress)
    .filter((connector) => connector !== chainConstants.weth)
    .filter((connector) => connector !== chainConstants.usdc)
    .filter((connector) => connector !== systemTokenAddress);

  console.log("\n[Step 5] Connectors:");
  console.log(`  Count: ${connectors.length}`);
  console.log(`  First 5: ${connectors.slice(0, 5).join(", ")}`);

  console.log("\n[Step 6] System token address:", systemTokenAddress);

  // Step 7: Create RPC client (replicates eth_client from Constants.ts)
  const client = createPublicClient({
    chain: optimism,
    transport: http(RPC_URL, {
      batch: true,
      timeout: 30000,
    }),
  });

  // Step 8: Fetch token price (replicates fetchTokenPrice)
  console.log("\n[Step 8] Fetching token price...");
  try {
    const priceData = await fetchTokenPrice(
      tokenAddress,
      chainConstants.usdc,
      systemTokenAddress,
      chainConstants.weth,
      connectors,
      chainId,
      roundedBlockNumber,
      client as PublicClient,
      mockLogger,
      gasLimit || DEFAULT_GAS_LIMIT,
    );

    console.log("\n✅ SUCCESS!");
    console.log("Price (raw):", priceData.pricePerUSDNew.toString());
    console.log("Oracle Type:", priceData.priceOracleType);
  } catch (error) {
    console.log("\n❌ ERROR!");
    console.log(
      "Error type:",
      error instanceof Error ? error.constructor.name : typeof error,
    );
    console.log(
      "Error message:",
      error instanceof Error ? error.message : String(error),
    );

    if (error instanceof Error) {
      const errorStr = error.toString();
      if (errorStr.includes("historical state")) {
        console.log("\n⚠️  Historical state not available error detected!");
      }
      if (errorStr.includes("out of gas")) {
        console.log("\n⚠️  Out of gas error detected!");
      }
    }
    throw error;
  }
}

// Main execution
async function main() {
  // Parameters from the error message
  const TOKEN_ADDRESS = "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4";
  const BLOCK_NUMBER = 144795797; // Original block from error log
  const CHAIN_ID = 10; // Optimism

  // You can also test with different gas limits
  // Set GAS_LIMIT=1000000 to test with 1M gas (what the indexer error showed)
  const GAS_LIMIT = process.env.GAS_LIMIT
    ? BigInt(process.env.GAS_LIMIT)
    : DEFAULT_GAS_LIMIT;

  console.log("\nConfiguration:");
  console.log("Gas limit:", GAS_LIMIT.toString());

  try {
    await replicateTokenPriceFetch(
      TOKEN_ADDRESS,
      BLOCK_NUMBER,
      CHAIN_ID,
      GAS_LIMIT,
    );
  } catch (error) {
    console.error("\nFatal error:", error);
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n=== Test completed ===");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
