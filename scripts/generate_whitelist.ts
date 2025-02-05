// Run with: deno run --allow-read --allow-write --node-modules-dir scripts/generate_whitelist.ts
import { parse } from "https://deno.land/std@0.182.0/csv/mod.ts";
import Web3 from "npm:web3@4.0.1";
import "jsr:@std/dotenv/load";

const CHAIN_ARGS = {
  base: {
    RPC_URL: Deno.env.get("ENVIO_BASE_RPC_URL"),
    TOKENS_FILE: "src/constants/Aerodrome-Whitelisted.csv",
    OUTPUT_FILE: "src/constants/baseWhitelistedTokens.json",
  },
  optimism: {
    RPC_URL: Deno.env.get("ENVIO_OPTIMISM_RPC_URL"),
    TOKENS_FILE: "src/constants/Velodrome-Whitelisted.csv",
    OUTPUT_FILE: "src/constants/optimismWhitelistedTokens.json",
  },
  mode: {
    RPC_URL: Deno.env.get("ENVIO_MODE_RPC_URL"),
    TOKENS_FILE: "src/constants/Mode-Whitelisted.csv",
    OUTPUT_FILE: "src/constants/modeWhitelistedTokens.json",
  },
  fraxtal: {
    RPC_URL: Deno.env.get("ENVIO_FRAX_RPC_URL") || "https://rpc.frax.com",
    TOKENS_FILE: "src/constants/Fraxtal-Whitelisted.csv",
    OUTPUT_FILE: "src/constants/fraxtalWhitelistedTokens.json",
  },
};

/**
 * Generates the whitelist of tokens for a given chain and writes it to a JSON file.
 * @param chain - The chain to generate the whitelist for.
 */
async function generateTokenData(chain: string) {
  // Load environment variables
  const RPC_URL = CHAIN_ARGS[chain].RPC_URL;
  if (!RPC_URL) {
    console.error(
      `${chain.toUpperCase()}_RPC_URL is not set in the environment variables`
    );
    Deno.exit(1);
  }

  const TOKENS_FILE = CHAIN_ARGS[chain].TOKENS_FILE;
  const OUTPUT_FILE = CHAIN_ARGS[chain].OUTPUT_FILE;

  // Load ERC20 ABI from file
  const ERC20_ABI = JSON.parse(await Deno.readTextFile("./abis/ERC20.json"));

  // Initialize Web3 provider
  const web3 = new Web3(RPC_URL);

  // Read and parse CSV file
  const csvContent = await Deno.readTextFile(TOKENS_FILE);
  const records = parse(csvContent, { skipFirstRow: true });

  type TokenData = {
    address: string;
    symbol: string;
    decimals: number;
    createdBlock: number;
  };

  const whitelistedTokens: TokenData[] = [];

  for (const record of records) {
    const { address, blocktime } = record;
    try {
      const contract = new web3.eth.Contract(ERC20_ABI, address);

      const [symbol, decimals] = await Promise.all([
        contract.methods.symbol().call({}),
        contract.methods.decimals().call({}),
      ]);

      whitelistedTokens.push({
        address,
        symbol,
        decimals: Number(decimals),
        createdBlock: Number(blocktime),
      });

      console.log(`Processed token: ${symbol} at address ${address}`);
    } catch (error) {
      console.error(
        `Error processing token at address ${address}:`,
        error.message
      );
    }
  }

  whitelistedTokens.reverse();

  // Write the result to a JSON file
  await Deno.writeTextFile(
    OUTPUT_FILE,
    JSON.stringify(whitelistedTokens, null, 2)
  );
  console.log(`Whitelist generated successfully for ${chain}!`);
}

for (const chain in CHAIN_ARGS) {
  await generateTokenData(chain);
}
