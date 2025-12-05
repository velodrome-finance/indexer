/**
 * Script to fetch token prices using Oracle V3 for a list of tokens
 *
 * Usage:
 *   pnpm exec ts-node scripts/fetch_prices_v3.ts [blockNumber]
 *
 * If blockNumber is not provided, uses a recent block (after Oracle V3 deployment)
 */

import dotenv from "dotenv";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { http, createPublicClient } from "viem";
import { optimism } from "viem/chains";
import type { handlerContext } from "../generated/src/Types.gen";
import { CHAIN_CONSTANTS, PriceOracleType } from "../src/Constants";
import { getTokenDetails, getTokenPrice } from "../src/Effects/Token";

dotenv.config();

// List of tokens to fetch prices for
const TOKENS = [
  "0x87eEE96D50Fb761AD85B1c982d28A042169d61b1",
  "0xc5102fE9359FD9a28f877a67E36B0F050d81a3CC",
  "0xFdb794692724153d1488CcdBE0C56c252596735F",
  "0xAb1047894dA4ec207c71bE0AEF5c7885e07B2DaF",
  "0x66E535e8D2ebf13F49F3D49e5c50395a97C137b1",
  "0xf467C7d5a4A9C4687fFc7986aC6aD5A4c81E1404",
  "0xCa0E54b636DB823847B29F506BFFEE743F57729D",
  "0x9a2e53158e12BC09270Af10C16A466cb2b5D7836",
  "0x259c1C2ED264402b5ed2f02bc7dC25A15C680c18",
  "0xdC6fF44d5d932Cbd77B52E5612Ba0529DC6226F1",
  "0xfD389Dc9533717239856190F42475d3f263a270d",
  "0x217D47011b23BB961eB6D93cA9945B7501a5BB11",
  "0x3E29D3A9316dAB217754d13b28646B76607c5f04",
  "0xD9cC3D70E730503E7f28c1B407389198c4B75FA2",
  "0x9d36F8f62347538440a212e9162f534f797542df",
  "0x395Ae52bB17aef68C2888d941736A71dC6d4e125",
  "0xc3864f98f2a61A7cAeb95b039D031b4E2f55e0e9",
  "0xC03b43d492d904406db2d7D57e67C7e8234bA752",
  "0xc55E93C62874D8100dBd2DfE307EDc1036ad5434",
  "0x4200000000000000000000000000000000000006",
  "0x79E6c6b6aABA4432FAbacB30cC0C879D8f3E598e",
  "0x00e1724885473B63bCE08a9f0a52F35b0979e35A",
  "0x25193034153AfB4251a8E02a8Db0DeaeF4C876F6",
  "0xEB466342C4d449BC9f53A865D5Cb90586f405215",
  "0xA88594D404727625A9437C3f886C7643872296AE",
  "0x375488F097176507e39B9653b88FDc52cDE736Bf",
  "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF",
  "0x920Cf626a271321C151D027030D5d08aF699456b",
  "0x2416092f143378750bb29b79eD961ab195CcEea5",
  "0x8Fc7C1109c08904160d6AE36482B79814D45eB78",
  "0x528CDc92eAB044E1E39FE43B9514bfdAB4412B98",
  "0xAF9fE3B5cCDAe78188B1F8b9a49Da7ae9510F151",
  "0x7a1263eC3Bf0a19e25C553B8A2C312e903262C5E",
  "0xDC8840A0A1EBf8Be5aCE62A7D9360DfCB26aDFFC",
  "0xFf733b2A3557a7ed6697007ab5D11B79FdD1b76B",
  "0x7D14206C937E70e19E3A5B94011fAF0d5b3928e2",
  "0xfe5B10F053871e66a319a57a16CF4e709f51367F",
  "0x894134a25a5faC1c2C26F1d8fBf05111a3CB9487",
  "0x61BAADcF22d2565B0F471b291C475db5555e0b76",
  "0x3Eb398fEc5F7327C6b15099a9681d9568ded2e82",
  "0x5d47bAbA0d66083C52009271faF3F50DCc01023C",
  "0x17Aabf6838a6303fc6E9C5A227DC1EB6d95c829A",
  "0x747e42Eb0591547a0ab429B3627816208c734EA7",
  "0x399FE73Bb0Ee60670430FD92fE25A0Fdd308E142",
  "0x38B0873219A61797Be7B52e44E8Ff2b275e5dAAd",
  "0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49",
  "0x80137510979822322193FC997d400D5A6C747bf7",
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  "0x084382D1cc4f4DFD1769b1cC1Ac2A9b1f8365e90",
  "0xeB585163DEbB1E637c6D617de3bEF99347cd75c8",
  "0x2E3D870790dC77A83DD1d18184Acc7439A53f475",
  "0x8aE125E8653821E851F12A49F7765db9a9ce7384",
  "0x8901cB2e82CC95c01e42206F8d1F417FE53e7Af0",
  "0xaf20f5f19698f1D19351028cd7103B63D30DE7d7",
  "0x15e770B95Edd73fD96b02EcE0266247D50895E76",
  "0x385719545Ef34d457A88e723504544A53F0Ad9BC",
  "0xd52f94DF742a6F4B4C8b033369fE13A41782Bf44",
  "0x88a28b910A86E0aC47E048826288366FeE5E5F01",
];

const CHAIN_ID = 10; // Optimism
// Oracle V3 is deployed at block > 125484892 for Optimism
const ORACLE_V3_START_BLOCK = 125484892;

// Simple logger implementation
const logger: Envio_logger = {
  info: (msg: unknown) => console.log(`[INFO] ${msg}`),
  warn: (msg: unknown) => console.warn(`[WARN] ${msg}`),
  error: (msg: unknown) => console.error(`[ERROR] ${msg}`),
  debug: (msg: unknown) => console.debug(`[DEBUG] ${msg}`),
};

interface PriceResult {
  tokenAddress: string;
  price: bigint;
  priceFormatted: string;
  oracleType: string;
  success: boolean;
  error?: string;
}

async function fetchTokenPriceV3(
  tokenAddress: string,
  chainId: number,
  blockNumber: number,
  publicClient: PublicClient,
): Promise<PriceResult> {
  // Create mock context for the effect
  const mockContext = {
    effect: async (effectDef: unknown, input: unknown) => {
      // Handle nested getTokenDetails calls
      if (effectDef === getTokenDetails) {
        return await (
          getTokenDetails as unknown as {
            handler: (args: {
              input: unknown;
              context: handlerContext;
            }) => Promise<unknown>;
          }
        ).handler({
          input: input as { contractAddress: string; chainId: number },
          context: mockContext as unknown as handlerContext,
        });
      }
      // Should not have nested getTokenPrice calls
      if (effectDef === getTokenPrice) {
        throw new Error("Nested getTokenPrice call detected");
      }
      const effectName =
        (effectDef as { name?: string })?.name || String(effectDef);
      throw new Error(`Unknown effect: ${effectName}`);
    },
    ethClient: publicClient,
    log: logger,
    cache: true,
  } as unknown as handlerContext;

  try {
    // Call the getTokenPrice effect
    const result = await (
      getTokenPrice as unknown as {
        handler: (args: {
          input: unknown;
          context: handlerContext;
        }) => Promise<{ pricePerUSDNew: bigint; priceOracleType: string }>;
      }
    ).handler({
      input: {
        tokenAddress,
        chainId,
        blockNumber,
        gasLimit: 10000000n, // 10M - matches getTokenPrice default
      },
      context: mockContext as handlerContext,
    });

    const priceFormatted =
      result.pricePerUSDNew > 0n
        ? (Number(result.pricePerUSDNew) / 1e18).toFixed(6)
        : "0.000000";

    return {
      tokenAddress,
      price: result.pricePerUSDNew,
      priceFormatted,
      oracleType: result.priceOracleType,
      success: result.pricePerUSDNew > 0n,
    };
  } catch (error) {
    return {
      tokenAddress,
      price: 0n,
      priceFormatted: "0.000000",
      oracleType: "unknown",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Get block number from args or use a recent one (after Oracle V3 deployment)
  let blockNumber: number;
  if (args.length > 0) {
    blockNumber = Number.parseInt(args[0], 10);
    if (Number.isNaN(blockNumber)) {
      console.error("Invalid block number provided");
      process.exit(1);
    }
  } else {
    // Use a block number after Oracle V3 deployment
    // Using a recent block (e.g., 130000000) to ensure V3 is active
    blockNumber = 130000000;
    console.log(`No block number provided, using default: ${blockNumber}`);
  }

  // Verify Oracle V3 is active at this block
  const oracleType = CHAIN_CONSTANTS[CHAIN_ID].oracle.getType(blockNumber);
  if (oracleType !== PriceOracleType.V3) {
    console.error(
      `⚠️  Warning: Oracle V3 is not active at block ${blockNumber}. ` +
        `Oracle type: ${oracleType}. V3 starts at block ${ORACLE_V3_START_BLOCK + 1}`,
    );
    console.log(`Using block ${blockNumber} anyway...`);
  }

  // Get RPC URL from environment
  const rpcUrl =
    process.env.ENVIO_OPTIMISM_RPC_URL || process.env.OPTIMISM_RPC_URL;
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

  console.log("=".repeat(80));
  console.log("Oracle V3 Price Fetch Script");
  console.log("=".repeat(80));
  console.log(`Chain ID: ${CHAIN_ID} (Optimism)`);
  console.log(`Block Number: ${blockNumber}`);
  console.log(`Oracle Type: ${oracleType}`);
  console.log(`Number of tokens: ${TOKENS.length}`);
  console.log("=".repeat(80));
  console.log();

  // Fetch prices for all tokens
  const results: PriceResult[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < TOKENS.length; i++) {
    const tokenAddress = TOKENS[i];
    process.stdout.write(
      `[${i + 1}/${TOKENS.length}] Fetching price for ${tokenAddress}... `,
    );

    const result = await fetchTokenPriceV3(
      tokenAddress,
      CHAIN_ID,
      blockNumber,
      publicClient,
    );

    results.push(result);

    if (result.success) {
      successCount++;
      console.log(`✅ ${result.priceFormatted} USD (${result.oracleType})`);
    } else {
      failCount++;
      console.log(
        `❌ Failed${result.error ? `: ${result.error}` : " (price is zero)"}`,
      );
    }

    // Small delay to avoid rate limiting
    if (i < TOKENS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Summary
  console.log();
  console.log("=".repeat(80));
  console.log("Summary");
  console.log("=".repeat(80));
  console.log(`Total tokens: ${TOKENS.length}`);
  console.log(`Successful: ${successCount} ✅`);
  console.log(`Failed: ${failCount} ❌`);
  console.log();

  // Show failed tokens
  if (failCount > 0) {
    console.log("Failed tokens:");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  - ${r.tokenAddress}${r.error ? ` (${r.error})` : ""}`);
    }
    console.log();
  }

  // Show successful tokens with prices
  console.log("Successful tokens:");
  for (const r of results.filter((r) => r.success)) {
    console.log(`  ${r.tokenAddress}: ${r.priceFormatted} USD`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
