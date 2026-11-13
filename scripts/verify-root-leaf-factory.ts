/**
 * Checks that a superchain root CL pool's leaf pool is the one created by the
 * leaf CLFactory whose address equals the root factory's address
 * (RootCLPoolFactory 0x04625B04…a55F on Optimism ↔ CLFactory 0x04625B04…a55F
 * on each leaf chain). That address equality is what
 * src/EventHandlers/RootCLPoolFactory.ts and the leaf-side pending-mapping
 * flush use to pick the right pool when two leaf pools share the
 * (chain, token0, token1, tickSpacing) matching hash.
 *
 * For each sample root pool (taken from Optimism RootPoolCreated logs) it calls,
 * on the leaf chain, `CLFactory(rootFactory).getPool(token0, token1, tickSpacing)`
 * and the returned pool's `factory()`. For Ink it also asks the second Ink
 * CLFactory, which holds a pool with the same hash.
 *
 * Usage: npx -y tsx@4.19.2 scripts/verify-root-leaf-factory.ts
 */
import "dotenv/config";
import { http, type PublicClient, createPublicClient, parseAbi } from "viem";
import { RPC_CHAINS, resolveRpcEndpoints } from "../src/Effects/RpcConfig";

const ROOT_FACTORY = "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F";
const ABI = parseAbi([
  "function getPool(address,address,int24) view returns (address)",
  "function factory() view returns (address)",
]);

type Sample = {
  label: string;
  leafChainId: number;
  rootPool: string;
  token0: `0x${string}`;
  token1: `0x${string}`;
  tickSpacing: number;
  otherFactories: `0x${string}`[];
};

// From Optimism RootPoolCreated logs emitted by ROOT_FACTORY.
const SAMPLES: Sample[] = [
  {
    label: "Ink USD₮0/WETH CL100",
    leafChainId: 57073,
    rootPool: "0x9f99185d476aA3632dFdB69faE43007E92B7ef7d",
    token0: "0x0200C29006150606B650577BBE7B6248F58470c1",
    token1: "0x4200000000000000000000000000000000000006",
    tickSpacing: 100,
    otherFactories: ["0x718E46d0962A66942E233760a8bd6038Ce54EdCD"],
  },
  {
    label: "Lisk CL1",
    leafChainId: 1135,
    rootPool: "0x0bce933da45b386813ba95185c6c61a1ae4b2f6c",
    token0: "0x1b10E2270780858923cdBbC9B5423e29fffD1A44",
    token1: "0x76D8de471F54aAA87784119c60Df1bbFc852C415",
    tickSpacing: 1,
    otherFactories: [],
  },
  {
    label: "Mode CL1",
    leafChainId: 34443,
    rootPool: "0xc284e963c5fedc333adf3277ae563beb16e4b47b",
    token0: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    token1: "0xd988097fb8612cc24eeC14542bC03424c656005f",
    tickSpacing: 1,
    otherFactories: [],
  },
];

let requests = 0;
function client(chainId: number): PublicClient {
  return createPublicClient({
    chain: RPC_CHAINS[chainId].viemChain,
    transport: http(resolveRpcEndpoints(chainId).primary.url, {
      batch: false,
      retryCount: 1,
      onFetchRequest: () => {
        requests++;
      },
    }),
    batch: { multicall: false },
  }) as PublicClient;
}

async function main() {
  for (const s of SAMPLES) {
    const c = client(s.leafChainId);
    for (const factory of [
      ROOT_FACTORY as `0x${string}`,
      ...s.otherFactories,
    ]) {
      const pool = (await c.readContract({
        address: factory,
        abi: ABI,
        functionName: "getPool",
        args: [s.token0, s.token1, s.tickSpacing],
      })) as `0x${string}`;
      const poolFactory =
        pool === "0x0000000000000000000000000000000000000000"
          ? "-"
          : ((await c.readContract({
              address: pool,
              abi: ABI,
              functionName: "factory",
            })) as string);
      const same = poolFactory.toLowerCase() === ROOT_FACTORY.toLowerCase();
      console.log(
        `${s.label.padEnd(22)} root=${s.rootPool} leafFactory=${factory} -> pool=${pool} pool.factory()=${poolFactory} ${same ? "(= root factory: the leaf pool)" : "(different factory: not the leaf pool)"}`,
      );
    }
  }
  console.log(`RPC requests: ${requests}`);
}
main();
