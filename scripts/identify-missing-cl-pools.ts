/**
 * Identifies CL pool addresses that are present on-chain in a `CLFactory` but
 * missing from the indexer's GraphQL — the operational follow-up to the
 * `[CL_FACTORY_POOL_COUNT_GAP]` audit check (issue #865).
 *
 * Unlike the V2 sibling (issue #864, scripts/identify-missing-pools.ts), Base
 * runs four CLFactories side by side and the per-chain `count(Pool, isCL=true)`
 * cannot tell us which factory owns the gap. So for each factory the script:
 *
 *   1. Reads `allPoolsLength()` from the factory (authoritative on-chain count).
 *   2. Enumerates the full on-chain set via `allPools(0..count-1)`.
 *   3. Queries the indexer GraphQL for every pool the indexer holds for that
 *      (chainId, factoryAddress) pair.
 *   4. Set-diffs on-chain minus indexer and prints each missing address
 *      together with the factory it came from. The factory label is the key
 *      diagnostic: it tells the operator whether to suspect a newest-factory
 *      registration race (e.g. CLGaugeFactoryV3) or an older long-history bug.
 *
 * Enumerating the full set (rather than only the tail like V2 does) matters
 * here because CL gaps in the 2026-06-11 audit were not concentrated at the
 * tail — they spanned 6 years of history across 4 factories.
 *
 * The printed addresses are the operator's input for the actual fix
 * (force-reindex window, manual investigation of `PoolCreated` logs in
 * indexer logs, etc.) — those steps live outside this repo.
 *
 * Scope: CL only. The sibling check for V2 PoolFactories is issue #864
 * (scripts/identify-missing-pools.ts).
 *
 * Usage:
 *   ENVIO_BASE_RPC_URL=https://... \
 *   GRAPHQL_URL=https://indexer.us.hyperindex.xyz/<slug>/v1/graphql \
 *   pnpm dlx tsx scripts/identify-missing-cl-pools.ts
 */

import "dotenv/config";
import { http, createPublicClient } from "viem";
import { RPC_HTTP_OPTIONS, toChecksumAddress } from "../src/Constants";

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

/**
 * CL factory targets covered by this check. The four Base CLFactories listed
 * here are the ones the 2026-06-11 audit flagged (issue #865); Optimism was
 * clean in the same audit but is included so per-factory drift is detected
 * the next time it slips. Extend as new CLFactories are added.
 */
const TARGETS: readonly FactoryTarget[] = [
  // Base — four CLFactories, all flagged in the 2026-06-11 audit.
  {
    chainId: 8453,
    envRpcKey: "ENVIO_BASE_RPC_URL",
    factoryAddress: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
    label: "Base CLFactory (oldest)",
  },
  {
    chainId: 8453,
    envRpcKey: "ENVIO_BASE_RPC_URL",
    factoryAddress: "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a",
    label: "Base CLFactory (#2)",
  },
  {
    chainId: 8453,
    envRpcKey: "ENVIO_BASE_RPC_URL",
    factoryAddress: "0x9592CD9B267748cbfBDe90Ac9F7DF3c437A6d51B",
    label: "Base CLFactory (#3, paired with NFPM 0xc741beb2…)",
  },
  {
    chainId: 8453,
    envRpcKey: "ENVIO_BASE_RPC_URL",
    factoryAddress: "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef",
    label: "Base CLFactory (newest, paired with CLGaugeFactoryV3)",
  },
  // Optimism — three CLFactories, clean in the 2026-06-11 audit.
  {
    chainId: 10,
    envRpcKey: "ENVIO_OPTIMISM_RPC_URL",
    factoryAddress: "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
    label: "Optimism CLFactory (oldest)",
  },
  {
    chainId: 10,
    envRpcKey: "ENVIO_OPTIMISM_RPC_URL",
    factoryAddress: "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F",
    label: "Optimism CLFactory (#2)",
  },
  {
    chainId: 10,
    envRpcKey: "ENVIO_OPTIMISM_RPC_URL",
    factoryAddress: "0xe13Dd1fbA721Aa81a1826D9523AC9BC7d260c879",
    label: "Optimism CLFactory (Slipstream gauge-V2)",
  },
];

/**
 * Returns the full set of pool addresses the indexer holds for a given
 * `(chainId, factoryAddress)` pair, lower-cased so the set-diff against the
 * on-chain enumeration is case-insensitive. Pages by `id` cursor because
 * Hasura defaults cap a single query at 1000 rows.
 *
 * @param url - Hasura GraphQL endpoint of the indexer to audit
 * @param chainId - EVM chain id to scope the query to
 * @param factoryAddress - Checksummed CLFactory address to filter on
 * @returns Lower-cased pool addresses keyed by `event.params.pool`
 */
async function gqlIndexerPoolSet(
  url: string,
  chainId: number,
  factoryAddress: string,
): Promise<Set<string>> {
  const pageSize = 1000;
  const found = new Set<string>();
  let cursor = "";
  for (;;) {
    const query = `query($chainId: numeric!, $factory: String!, $cursor: String!, $limit: Int!) {
      Pool(
        where: {
          chainId: { _eq: $chainId },
          isCL: { _eq: true },
          factoryAddress: { _eq: $factory },
          id: { _gt: $cursor }
        },
        order_by: { id: asc },
        limit: $limit
      ) { id poolAddress }
    }`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        variables: {
          chainId,
          factory: factoryAddress,
          cursor,
          limit: pageSize,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      data?: { Pool: { id: string; poolAddress: string }[] };
      errors?: unknown;
    };
    if (body.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    if (!body.data) throw new Error("GraphQL: empty data");
    const page = body.data.Pool;
    if (page.length === 0) break;
    for (const row of page) {
      found.add(row.poolAddress.toLowerCase());
    }
    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
  return found;
}

/**
 * Enumerates every pool address the on-chain factory has ever created via
 * `allPools(i)` for `i` in `[0, count)`. Uses viem's batching transport so
 * the calls fold into Multicall3 where available.
 */
async function onchainPoolList(
  client: ReturnType<typeof createPublicClient>,
  factoryAddress: `0x${string}`,
  count: number,
): Promise<`0x${string}`[]> {
  const indices = Array.from({ length: count }, (_, i) => i);
  return Promise.all(
    indices.map(
      (i) =>
        client.readContract({
          address: factoryAddress,
          abi: ALL_POOLS_ABI,
          functionName: "allPools",
          args: [BigInt(i)],
        }) as Promise<`0x${string}`>,
    ),
  );
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
    // batch.multicall lets viem fold serial `allPools(i)` reads into Multicall3
    // calls where available, turning ~thousands of round-trips into a handful.
    const client = createPublicClient({
      transport: http(rpcUrl, RPC_HTTP_OPTIONS),
      batch: { multicall: true },
    });

    const checksummedFactory = toChecksumAddress(target.factoryAddress);
    const onchainCountRaw = await client.readContract({
      address: target.factoryAddress,
      abi: ALL_POOLS_ABI,
      functionName: "allPoolsLength",
    });
    const onchainCount = Number(onchainCountRaw);

    const [onchainAddrs, indexerSet] = await Promise.all([
      onchainPoolList(client, target.factoryAddress, onchainCount),
      gqlIndexerPoolSet(graphqlUrl, target.chainId, checksummedFactory),
    ]);

    const indexerCount = indexerSet.size;
    console.log(
      `${target.label} (chain ${target.chainId}, ${checksummedFactory}):`,
    );
    console.log(`  on-chain allPoolsLength() = ${onchainCount}`);
    console.log(`  indexer CL Pool count     = ${indexerCount}`);

    const missing: { index: number; address: `0x${string}` }[] = [];
    for (const [i, addr] of onchainAddrs.entries()) {
      if (!indexerSet.has(addr.toLowerCase())) {
        missing.push({ index: i, address: addr });
      }
    }

    if (missing.length === 0) {
      console.log("  no gap — every on-chain pool is indexed.\n");
      continue;
    }

    totalMissing += missing.length;
    console.log(`  gap                       = ${missing.length} pool(s)`);
    console.log("  missing addresses (allPools index, address):");
    for (const { index, address } of missing) {
      console.log(`    #${index}  ${address}`);
    }
    console.log("");
  }

  if (totalMissing > 0) {
    console.log(`Total missing CL pools across factories: ${totalMissing}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
