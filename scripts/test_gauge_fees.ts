/**
 * Script to test gaugeFees contract call for CL pools
 *
 * Usage:
 *   pnpm exec ts-node scripts/test_gauge_fees.ts <poolAddress> [chainId] [blockNumber]
 *
 * Examples:
 *   pnpm exec ts-node scripts/test_gauge_fees.ts 0x8949A8E02998d76D7a703cAC9eE7e0f529828011 10 124019889
 */

import dotenv from "dotenv";
import type { PublicClient } from "viem";
import { http, createPublicClient } from "viem";
import { optimism } from "viem/chains";
import { fetchCurrentAccumulatedFeeCL } from "../src/Effects/DynamicFee";

dotenv.config();

// Simple logger implementation
const logger = {
  info: (msg: unknown) => console.log(`[INFO] ${msg}`),
  warn: (msg: unknown) => console.warn(`[WARN] ${msg}`),
  error: (msg: unknown, err?: unknown) => {
    console.error(`[ERROR] ${msg}`);
    if (err) {
      console.error(err);
    }
  },
  debug: (msg: unknown) => console.debug(`[DEBUG] ${msg}`),
};

async function testGaugeFees(
  poolAddress: string,
  chainId: number,
  blockNumber: number,
  publicClient: PublicClient,
): Promise<void> {
  console.log("=".repeat(80));
  console.log("Testing gaugeFees Contract Call");
  console.log("=".repeat(80));
  console.log(`Pool Address: ${poolAddress}`);
  console.log(`Chain ID: ${chainId} (Optimism)`);
  console.log(`Block Number: ${blockNumber}`);
  console.log("=".repeat(80));
  console.log();

  try {
    const result = await fetchCurrentAccumulatedFeeCL(
      poolAddress,
      chainId,
      blockNumber,
      publicClient,
      logger,
    );

    console.log("✅ Success!");
    console.log(`Token0 Fees: ${result.token0Fees.toString()}`);
    console.log(`Token1 Fees: ${result.token1Fees.toString()}`);
  } catch (error) {
    console.error("❌ Failed!");
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error("\nStack trace:");
        console.error(error.stack);
      }
    } else {
      console.error(`Error: ${String(error)}`);
    }
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      "Usage: pnpm exec ts-node scripts/test_gauge_fees.ts <poolAddress> [chainId] [blockNumber]",
    );
    console.error(
      "Example: pnpm exec ts-node scripts/test_gauge_fees.ts 0x8949A8E02998d76D7a703cAC9eE7e0f529828011 10 124019889",
    );
    process.exit(1);
  }

  const poolAddress = args[0];
  const chainId = args.length > 1 ? Number.parseInt(args[1], 10) : 10;
  const blockNumber =
    args.length > 2 ? Number.parseInt(args[2], 10) : 124019889;

  if (Number.isNaN(chainId)) {
    console.error("Invalid chain ID provided");
    process.exit(1);
  }

  if (Number.isNaN(blockNumber)) {
    console.error("Invalid block number provided");
    process.exit(1);
  }

  // Get RPC URL from environment
  const rpcUrl = "https://0xrpc.io/op";
  if (!rpcUrl) {
    throw new Error(
      "RPC URL not found. Please set ENVIO_OPTIMISM_RPC_URL or OPTIMISM_RPC_URL in .env file",
    );
  }

  // Create viem client
  const publicClient = createPublicClient({
    chain: optimism,
    transport: http(rpcUrl),
  }) as PublicClient;

  await testGaugeFees(poolAddress, chainId, blockNumber, publicClient);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
