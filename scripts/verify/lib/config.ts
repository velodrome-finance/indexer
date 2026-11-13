/**
 * Reads the indexer's own config.yaml so the harness follows whatever chains
 * and contracts the indexer is configured with (new chains or deployments are
 * picked up without harness changes).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./env";
import { type YamlValue, parseYaml } from "./yaml";

export interface ContractSpec {
  name: string;
  abiFile: string;
  /** Event entries as written in config.yaml: a bare name or a full signature with an alias. */
  events: { event: string; name?: string }[];
}

export interface ChainSpec {
  id: number;
  startBlock: number;
  endBlock?: number;
  hypersyncUrl?: string;
  /** Name of the env var holding the chain's RPC URL (parsed from `${VAR:-}`), if any. */
  rpcEnvVar?: string;
  /** contract name -> static addresses (empty for dynamically registered contracts). */
  contracts: Map<string, string[]>;
}

export interface IndexerConfig {
  contracts: Map<string, ContractSpec>;
  chains: Map<number, ChainSpec>;
}

type Obj = { [k: string]: YamlValue };

function asObj(v: YamlValue, what: string): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error(`Expected map for ${what}`);
  return v as Obj;
}

function asArr(v: YamlValue): YamlValue[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new Error("Expected list");
  return v;
}

/**
 * Loads and normalizes config.yaml.
 * @param file - Path to config.yaml (default: repository root)
 * @returns Contracts and chains, addresses lowercased
 */
export function loadIndexerConfig(
  file = path.join(REPO_ROOT, "config.yaml"),
): IndexerConfig {
  const root = asObj(parseYaml(readFileSync(file, "utf8")), "root");
  const contracts = new Map<string, ContractSpec>();
  for (const c of asArr(root.contracts)) {
    const o = asObj(c, "contract");
    const events = asArr(o.events).map((e) => {
      const eo = asObj(e, "event");
      return {
        event: String(eo.event),
        name: eo.name ? String(eo.name) : undefined,
      };
    });
    contracts.set(String(o.name), {
      name: String(o.name),
      abiFile: path.join(REPO_ROOT, String(o.abi_file_path)),
      events,
    });
  }
  const chains = new Map<number, ChainSpec>();
  for (const ch of asArr(root.chains)) {
    const o = asObj(ch, "chain");
    const id = Number(o.id);
    const cmap = new Map<string, string[]>();
    for (const c of asArr(o.contracts)) {
      const co = asObj(c, "chain contract");
      const addrs = asArr(co.address ?? null).map((a) =>
        String(a).toLowerCase(),
      );
      cmap.set(String(co.name), addrs);
    }
    let rpcEnvVar: string | undefined;
    for (const r of asArr(o.rpc ?? null)) {
      const ro = asObj(r, "rpc");
      const m = /\$\{([A-Z0-9_]+)/.exec(String(ro.url ?? ""));
      if (m) rpcEnvVar = m[1];
    }
    const hs = o.hypersync_config
      ? asObj(o.hypersync_config, "hypersync_config")
      : undefined;
    chains.set(id, {
      id,
      startBlock: Number(o.start_block ?? 0),
      endBlock:
        o.end_block !== undefined && o.end_block !== null
          ? Number(o.end_block)
          : undefined,
      hypersyncUrl: hs?.url ? String(hs.url) : undefined,
      rpcEnvVar,
      contracts: cmap,
    });
  }
  return { contracts, chains };
}

/** Contracts the indexer registers at runtime (empty `address:` lists in config.yaml). */
export const DYNAMIC_CONTRACTS = [
  "Pool",
  "CLPool",
  "Gauge",
  "CLGauge",
  "FeesVotingReward",
  "BribesVotingReward",
  "SuperchainIncentiveVotingReward",
  "ALMLPWrapperV1",
  "ALMLPWrapperV2",
] as const;
export type DynamicContract = (typeof DYNAMIC_CONTRACTS)[number];

/**
 * Static addresses of a chain, grouped by contract (dynamic contracts excluded).
 * @param chain - Chain spec
 * @returns contract name -> addresses
 */
export function staticContracts(chain: ChainSpec): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [name, addrs] of chain.contracts) {
    if ((DYNAMIC_CONTRACTS as readonly string[]).includes(name)) continue;
    if (addrs.length > 0) out.set(name, addrs);
  }
  return out;
}

/** Contract roles by config.yaml contract name, so new deployments (e.g. Aero*) are covered. */
export const ROLE = {
  /** CL pool factories: PoolCreated(token0, token1, tickSpacing, pool). */
  clFactory: (name: string): boolean =>
    /CLFactory$/.test(name) && !/^Root/.test(name),
  /** V2 pool factories: PoolCreated(token0, token1, [stable,] pool, ...). */
  v2Factory: (name: string): boolean =>
    /PoolFactory$/.test(name) &&
    !/^Root/.test(name) &&
    !/CLPoolFactory$/.test(name),
  /** Position managers (NFTs of CL positions). */
  nfpm: (name: string): boolean => /NFPM$/.test(name),
  /** Voters emitting GaugeCreated. */
  voter: (name: string): boolean => name === "Voter" || /LeafVoter$/.test(name),
};

/**
 * Static addresses of a chain's contracts that have a role.
 * @param chain - Chain spec
 * @param role - Role predicate on the contract name
 * @returns Lowercase addresses
 */
export function addressesWithRole(
  chain: ChainSpec,
  role: (name: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const [name, addrs] of chain.contracts)
    if (role(name)) out.push(...addrs);
  return out;
}
