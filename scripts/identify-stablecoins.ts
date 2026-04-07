/**
 * Identify stablecoins across all chains from destination tokens + price connectors.
 * Usage: pnpm tsx scripts/identify-stablecoins.ts
 */
import { http, createPublicClient, parseAbi } from "viem";
import {
  base,
  celo,
  fraxtal,
  ink,
  lisk,
  metalL2,
  mode,
  optimism,
  soneium,
  swellchain,
  unichain,
} from "viem/chains";
import PriceConnectors from "../src/constants/price_connectors.json";

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
]);

interface ChainInfo {
  name: string;
  chainId: number;
  chain: any;
  rpc: string;
  destToken: string;
  destDecimals: number;
  connectors: { address: string; createdBlock: number }[];
}

const CHAINS: ChainInfo[] = [
  {
    name: "Optimism",
    chainId: 10,
    chain: optimism,
    rpc: "https://mainnet.optimism.io",
    destToken: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    destDecimals: 6,
    connectors: PriceConnectors.optimism,
  },
  {
    name: "Base",
    chainId: 8453,
    chain: base,
    rpc: "https://base-rpc.publicnode.com",
    destToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    destDecimals: 6,
    connectors: PriceConnectors.base,
  },
  {
    name: "Celo",
    chainId: 42220,
    chain: celo,
    rpc: "https://celo.drpc.org",
    destToken: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    destDecimals: 6,
    connectors: PriceConnectors.celo,
  },
  {
    name: "Soneium",
    chainId: 1868,
    chain: soneium,
    rpc: "https://soneium.drpc.org",
    destToken: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
    destDecimals: 6,
    connectors: PriceConnectors.soneium,
  },
  {
    name: "Swell",
    chainId: 1923,
    chain: swellchain,
    rpc: "https://rpc.ankr.com/swell",
    destToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    destDecimals: 18,
    connectors: PriceConnectors.swellchain,
  },
  {
    name: "Mode",
    chainId: 34443,
    chain: mode,
    rpc: "https://1rpc.io/mode",
    destToken: "0xd988097fb8612cc24eeC14542bC03424c656005f",
    destDecimals: 6,
    connectors: PriceConnectors.mode,
  },
  {
    name: "Lisk",
    chainId: 1135,
    chain: lisk,
    rpc: "https://lisk.drpc.org",
    destToken: "0x05D032ac25d322df992303dCa074EE7392C117b9",
    destDecimals: 6,
    connectors: PriceConnectors.lisk,
  },
  {
    name: "Fraxtal",
    chainId: 252,
    chain: fraxtal,
    rpc: "https://fraxtal.drpc.org",
    destToken: "0xFc00000000000000000000000000000000000001",
    destDecimals: 18,
    connectors: PriceConnectors.fraxtal,
  },
  {
    name: "Unichain",
    chainId: 130,
    chain: unichain,
    rpc: "https://0xrpc.io/uni",
    destToken: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    destDecimals: 6,
    connectors: PriceConnectors.unichain,
  },
  {
    name: "Ink",
    chainId: 57073,
    chain: ink,
    rpc: "https://ink.drpc.org",
    destToken: "0xF1815bd50389c46847f0Bda824eC8da914045D14",
    destDecimals: 6,
    connectors: PriceConnectors.ink,
  },
  {
    name: "Metal",
    chainId: 1750,
    chain: metalL2,
    rpc: "https://metall2.drpc.org",
    destToken: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    destDecimals: 6,
    connectors: PriceConnectors.metal,
  },
];

// Known stablecoin symbols
const STABLECOIN_SYMBOLS = new Set([
  "USDC",
  "USDC.e",
  "USDbC",
  "USDT",
  "USD₮",
  "oUSDT",
  "USD₮0",
  "DAI",
  "FRAX",
  "frxUSD",
  "USDe",
  "sUSDe",
  "LUSD",
  "BUSD",
  "USDm",
  "cUSD",
  "USDK",
  "USR",
  "rUSDC",
]);

// Known non-stablecoin patterns (governance tokens, ETH derivatives, etc.)
const NOT_STABLECOINS = new Set([
  "WETH",
  "VELO",
  "XVELO",
  "OP",
  "AERO",
  "WBTC",
  "wstETH",
  "rETH",
  "cbETH",
  "CELO",
  "MODE",
  "LISK",
  "FXS",
  "sfrxETH",
  "LSK",
  "MTL",
]);

async function main() {
  console.log(
    "Identifying stablecoins in destination tokens + price connectors\n",
  );
  console.log(
    "Format: [chain] address → symbol (decimals) | STABLECOIN? | role\n",
  );

  const stablecoinMap: Record<
    string,
    { chains: string[]; symbol: string; decimals: number; address: string }[]
  > = {};

  for (const chain of CHAINS) {
    const client = createPublicClient({
      chain: chain.chain,
      transport: http(chain.rpc, { timeout: 20000, retryCount: 2 }),
    });

    // Collect all unique addresses: destination + connectors
    const addresses = new Map<string, string>(); // address -> role
    addresses.set(chain.destToken.toLowerCase(), "destination");
    for (const c of chain.connectors) {
      if (!addresses.has(c.address.toLowerCase())) {
        addresses.set(c.address.toLowerCase(), "connector");
      }
    }

    console.log(`--- ${chain.name} (${chain.chainId}) ---`);

    for (const [addr, role] of addresses) {
      try {
        const [symbol, decimals, name] = await Promise.all([
          client.readContract({
            address: addr as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "symbol",
          }),
          client.readContract({
            address: addr as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
          client
            .readContract({
              address: addr as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "name",
            })
            .catch(() => ""),
        ]);

        const sym = symbol as string;
        const dec = Number(decimals);
        const isStable =
          STABLECOIN_SYMBOLS.has(sym) ||
          (sym.includes("USD") && !NOT_STABLECOINS.has(sym)) ||
          (name as string).toLowerCase().includes("usd");

        const tag = isStable
          ? "✅ STABLECOIN"
          : NOT_STABLECOINS.has(sym)
            ? "  (not stable)"
            : "  ???";
        console.log(`  ${addr} → ${sym} (${dec} dec) | ${tag} | ${role}`);

        if (isStable) {
          const key = `${sym}-${dec}`;
          if (!stablecoinMap[key]) stablecoinMap[key] = [];
          stablecoinMap[key].push({
            chains: [chain.name],
            symbol: sym,
            decimals: dec,
            address: addr,
          });
        }
      } catch {
        console.log(`  ${addr} → FAILED | ${role}`);
      }
    }
    console.log();
  }

  // Summary: unique stablecoins across chains
  console.log("\n=== STABLECOIN SUMMARY ===\n");
  console.log(
    "These are the stablecoins found in destination tokens + connectors that could be hardcoded:\n",
  );

  // Group by address across chains
  const allStablecoins = new Map<
    string,
    { symbol: string; decimals: number; chains: string[]; role: string }
  >();

  for (const chain of CHAINS) {
    const addresses = new Map<string, string>();
    addresses.set(chain.destToken.toLowerCase(), "destination");
    for (const c of chain.connectors) {
      if (!addresses.has(c.address.toLowerCase())) {
        addresses.set(c.address.toLowerCase(), "connector");
      }
    }
    for (const [addr, role] of addresses) {
      const key = `${chain.chainId}-${addr}`;
      // Check if we identified it as stablecoin (simple heuristic: look at address patterns)
      if (!allStablecoins.has(key)) {
        // We'll look up symbol from what we already printed
      }
    }
  }
}

main().catch(console.error);
