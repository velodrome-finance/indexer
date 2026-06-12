/**
 * Identifies V2 pool addresses that are present on-chain in a `PoolFactory`
 * but missing from the indexer's GraphQL — the operational follow-up to the
 * `[FACTORY_POOL_COUNT_GAP]` audit check (issue #864).
 *
 * For each `(chainId, factoryAddress)` pair (default: Base PoolFactory),
 * the script:
 *
 *   1. Reads `allPoolsLength()` from the factory (authoritative on-chain count).
 *   2. Queries the indexer GraphQL for the indexer's V2 pool count on that chain.
 *   3. If the indexer is behind, iterates `allPools(i)` from `indexer_count` to
 *      `factory_count - 1` and prints each missing address with its index.
 *
 * The printed addresses are the operator's input for the actual fix
 * (force-reindex window, manual investigation of `PoolCreated` logs in
 * indexer logs, etc.) — those steps live outside this repo.
 *
 * Scope: V2 only. The sibling check for CL factories is issue #865.
 *
 * Usage:
 *   ENVIO_BASE_RPC_URL=https://... \
 *   GRAPHQL_URL=https://indexer.us.hyperindex.xyz/<slug>/v1/graphql \
 *   pnpm dlx tsx scripts/identify-missing-pools.ts
 */

import "dotenv/config";
import { http, createPublicClient } from "viem";
import { RPC_HTTP_OPTIONS } from "../src/Constants";

const ALL_POOLS_ABI = [
  {
    inputs: [],
    name: "allPoolsLength",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "allPools",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

type FactoryTarget = {
  chainId: number;
  envRpcKey: string;
  factoryAddress: `0x${string}`;
  label: string;
};

/** V2 PoolFactory targets covered by this check. Extend as needed. */
const TARGETS: readonly FactoryTarget[] = [
  {
    chainId: 8453,
    envRpcKey: "ENVIO_BASE_RPC_URL",
    factoryAddress: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    label: "Base PoolFactory",
  },
];

async function gqlIndexerCount(url: string, chainId: number): Promise<number> {
  const query = `query($chainId: numeric!) {
    Pool_aggregate(where: { chainId: { _eq: $chainId }, isCL: { _eq: false } }) {
      aggregate { count }
    }
  }`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { chainId } }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    data?: { Pool_aggregate: { aggregate: { count: number } } };
    errors?: unknown;
  };
  if (body.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  if (!body.data) throw new Error("GraphQL: empty data");
  return body.data.Pool_aggregate.aggregate.count;
}

async function main(): Promise<void> {
  const graphqlUrl = process.env.GRAPHQL_URL;
  if (!graphqlUrl) {
    console.error(
      "GRAPHQL_URL is required (Hasura endpoint of the indexer to audit).",
    );
    process.exit(1);
  }

  let totalMissing = 0;
  for (const target of TARGETS) {
    const rpcUrl = process.env[target.envRpcKey];
    if (!rpcUrl) {
      console.warn(`${target.label}: skipping — ${target.envRpcKey} unset.`);
      continue;
    }
    const client = createPublicClient({
      transport: http(rpcUrl, RPC_HTTP_OPTIONS),
    });

    const [onchainCountRaw, indexerCount] = await Promise.all([
      client.readContract({
        address: target.factoryAddress,
        abi: ALL_POOLS_ABI,
        functionName: "allPoolsLength",
      }),
      gqlIndexerCount(graphqlUrl, target.chainId),
    ]);
    const onchainCount = Number(onchainCountRaw);

    console.log(
      `${target.label} (chain ${target.chainId}, ${target.factoryAddress}):`,
    );
    console.log(`  on-chain allPoolsLength()  = ${onchainCount}`);
    console.log(`  indexer V2 Pool count      = ${indexerCount}`);

    if (indexerCount >= onchainCount) {
      console.log("  no gap — indexer is current.\n");
      continue;
    }

    const gap = onchainCount - indexerCount;
    totalMissing += gap;
    console.log(`  gap                        = ${gap} pool(s)`);
    console.log(
      `  enumerating allPools(${indexerCount}..${onchainCount - 1}):`,
    );

    for (let i = indexerCount; i < onchainCount; i++) {
      const addr = (await client.readContract({
        address: target.factoryAddress,
        abi: ALL_POOLS_ABI,
        functionName: "allPools",
        args: [BigInt(i)],
      })) as `0x${string}`;
      console.log(`    #${i}  ${addr}`);
    }
    console.log("");
  }

  if (totalMissing > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
