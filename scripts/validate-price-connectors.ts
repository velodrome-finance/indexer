/**
 * Validates that every price connector in price_connectors.json is a real ERC20:
 * has contract code and a callable decimals() that returns a valid uint8.
 *
 * Usage:
 *   pnpm tsx scripts/validate-price-connectors.ts
 *
 * Uses default RPC URLs from Constants (env vars override when set for the indexer).
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { http, createPublicClient } from "viem";
import { RPC_HTTP_OPTIONS } from "../src/Constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Max concurrent RPCs per chain to avoid rate limits */
const CONCURRENCY = 10;

const ERC20_DECIMALS_ABI = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** Map price_connectors.json top-level key to chain ID */
const CHAIN_KEY_TO_CHAIN_ID: Record<string, number> = {
  optimism: 10,
  base: 8453,
  mode: 34443,
  lisk: 1135,
  fraxtal: 252,
  soneium: 1868,
  ink: 57073,
  metal: 1750,
  unichain: 130,
  celo: 42220,
  swellchain: 1923,
};

type PriceConnector = { address: string; createdBlock: number };
type ConnectorReport = {
  chain: string;
  address: string;
  status: "ok" | "no_code" | "decimals_failed";
  decimals?: number;
  error?: string;
};

async function validateConnector(
  client: ReturnType<typeof createPublicClient>,
  address: string,
): Promise<{
  status: "ok" | "no_code" | "decimals_failed";
  decimals?: number;
  error?: string;
}> {
  const code = await client.getBytecode({ address: address as `0x${string}` });
  if (!code || code === "0x" || code.length <= 2) {
    return { status: "no_code" };
  }
  try {
    const decimals = await client.readContract({
      address: address as `0x${string}`,
      abi: ERC20_DECIMALS_ABI,
      functionName: "decimals",
    });
    return { status: "ok", decimals: Number(decimals) };
  } catch (err) {
    return {
      status: "decimals_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const jsonPath = path.join(
    __dirname,
    "..",
    "src",
    "constants",
    "price_connectors.json",
  );
  const raw = readFileSync(jsonPath, "utf-8");
  const connectorsByChain = JSON.parse(raw) as Record<string, PriceConnector[]>;

  const reports: ConnectorReport[] = [];

  for (const [chainKey, connectors] of Object.entries(connectorsByChain)) {
    const chainId = CHAIN_KEY_TO_CHAIN_ID[chainKey];
    if (chainId == null) {
      console.warn(`Unknown chain key "${chainKey}", skipping.`);
      continue;
    }
    const envRpcKey =
      chainKey === "swellchain"
        ? "ENVIO_SWELL_RPC_URL"
        : `ENVIO_${chainKey.toUpperCase()}_RPC_URL`;
    const rpcUrl = process.env[envRpcKey];
    if (!rpcUrl) {
      console.warn(
        `No RPC URL for chain ${chainKey} (chainId ${chainId}), skipping.`,
      );
      continue;
    }

    const client = createPublicClient({
      transport: http(rpcUrl, RPC_HTTP_OPTIONS),
    });

    for (let i = 0; i < connectors.length; i += CONCURRENCY) {
      const chunk = connectors.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(({ address }) =>
          validateConnector(client, address).then((result) => ({
            address,
            result,
          })),
        ),
      );
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        const address = chunk[j].address;
        if (s.status === "fulfilled") {
          const { result } = s.value;
          reports.push({
            chain: chainKey,
            address,
            status: result.status,
            decimals: result.decimals,
            error: result.error,
          });
        } else {
          reports.push({
            chain: chainKey,
            address,
            status: "decimals_failed",
            error:
              s.reason instanceof Error ? s.reason.message : String(s.reason),
          });
        }
      }
    }
  }

  const invalid = reports.filter((r) => r.status !== "ok");
  const ok = reports.filter((r) => r.status === "ok");

  console.log("--- Price connector validation report ---\n");
  if (invalid.length > 0) {
    console.log("INVALID (no code or decimals() failed):");
    for (const r of invalid) {
      console.log(
        `  ${r.chain} ${r.address}  ${r.status}${r.error ? `  ${r.error}` : ""}`,
      );
    }
    console.log("");
  }
  console.log(
    `Total: ${reports.length}  OK: ${ok.length}  Invalid: ${invalid.length}\n`,
  );
  if (invalid.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
