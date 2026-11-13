/**
 * Event ABI registry: topic0 lookup and a fast decoder for logs.
 *
 * All indexed events of interest have static parameters only (address, bool,
 * u/intN), so decoding is a word slice per parameter. Events with dynamic
 * parameters fall back to viem's decodeEventLog.
 */
import { readFileSync } from "node:fs";
import {
  type AbiEvent,
  type Hex,
  decodeEventLog,
  parseAbiItem,
  toEventSelector,
} from "viem";
import type { ContractSpec, IndexerConfig } from "./config";
import type { HsLog } from "./hypersync";

export interface EventDef {
  contract: string;
  /** Name the indexer uses for the event (config alias when one is set). */
  name: string;
  topic0: string;
  abi: AbiEvent;
  /** True when config.yaml lists the event for this contract (the indexer handles it). */
  configured: boolean;
  isStatic: boolean;
}

export type Decoded = Record<string, bigint | string | boolean>;

function isStaticType(t: string): boolean {
  return (
    t === "address" ||
    t === "bool" ||
    /^u?int\d*$/.test(t) ||
    /^bytes([1-9]|[12]\d|3[0-2])$/.test(t)
  );
}

/** Registry of event definitions per contract. */
export class AbiRegistry {
  readonly byContract = new Map<string, EventDef[]>();

  /**
   * Builds the registry from config.yaml contracts.
   * @param cfg - Indexer config
   */
  constructor(cfg: IndexerConfig) {
    for (const spec of cfg.contracts.values()) this.addContract(spec);
  }

  private addContract(spec: ContractSpec): void {
    const raw = spec.abiFile
      ? JSON.parse(readFileSync(spec.abiFile, "utf8"))
      : [];
    const abi: AbiEvent[] = (Array.isArray(raw) ? raw : raw.abi).filter(
      (x: { type: string }) => x.type === "event",
    );
    const defs: EventDef[] = [];
    const configuredNames = new Map<string, string | undefined>();
    for (const e of spec.events) configuredNames.set(e.event, e.name);
    for (const ev of abi) {
      const topic0 = toEventSelector(ev).toLowerCase();
      defs.push({
        contract: spec.name,
        name: ev.name,
        topic0,
        abi: ev,
        configured: configuredNames.has(ev.name),
        isStatic: ev.inputs.every((i) => isStaticType(i.type)),
      });
    }
    // Full-signature entries (e.g. the 4-arg superchain V2 Mint) are separate events.
    for (const e of spec.events) {
      if (!e.event.includes("(")) continue;
      const ev = parseAbiItem(`event ${e.event}`) as AbiEvent;
      const topic0 = toEventSelector(ev).toLowerCase();
      const existing = defs.find((d) => d.topic0 === topic0);
      if (existing) {
        existing.configured = true;
        existing.name = e.name ?? existing.name;
      } else {
        defs.push({
          contract: spec.name,
          name: e.name ?? ev.name,
          topic0,
          abi: ev,
          configured: true,
          isStatic: ev.inputs.every((i) => isStaticType(i.type)),
        });
      }
    }
    this.byContract.set(spec.name, defs);
  }

  /**
   * Looks up an event of a contract by indexer name.
   * @param contract - Contract name from config.yaml
   * @param name - Event name (or alias)
   * @returns Event definition
   */
  event(contract: string, name: string): EventDef {
    const d = this.byContract.get(contract)?.find((x) => x.name === name);
    if (!d) throw new Error(`Unknown event ${contract}.${name}`);
    return d;
  }

  /**
   * Events of a contract keyed by topic0.
   * @param contract - Contract name
   * @returns topic0 -> definition
   */
  topicMap(contract: string): Map<string, EventDef> {
    const m = new Map<string, EventDef>();
    for (const d of this.byContract.get(contract) ?? []) m.set(d.topic0, d);
    return m;
  }
}

function word(data: string, i: number): string {
  return data.slice(2 + i * 64, 2 + (i + 1) * 64);
}

function decodeStatic(type: string, hex64: string): bigint | string | boolean {
  if (type === "address") return `0x${hex64.slice(24)}`;
  if (type === "bool") return BigInt(`0x${hex64}`) !== 0n;
  if (type.startsWith("uint")) return BigInt(`0x${hex64}`);
  if (type.startsWith("int")) {
    const bits = Number(type.slice(3) || "256");
    let v = BigInt(`0x${hex64}`);
    // Values are sign-extended to 256 bits in the ABI encoding.
    if (v >> 255n === 1n) v -= 1n << 256n;
    void bits;
    return v;
  }
  return `0x${hex64}`;
}

/**
 * Decodes a log with a known event definition. Addresses are lowercase.
 * @param def - Event definition
 * @param log - HyperSync log
 * @returns Parameter name -> value
 */
export function decodeLog(def: EventDef, log: HsLog): Decoded {
  const out: Decoded = {};
  if (def.isStatic) {
    let t = 1;
    let d = 0;
    const topics = [log.topic0, log.topic1, log.topic2, log.topic3];
    for (const inp of def.abi.inputs) {
      const name = inp.name ?? "";
      if (inp.indexed) {
        const tp = topics[t++];
        out[name] = decodeStatic(
          inp.type,
          (tp ?? "0x").slice(2).padStart(64, "0"),
        );
      } else {
        out[name] = decodeStatic(inp.type, word(log.data, d++));
      }
    }
    return out;
  }
  const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(
    (x): x is string => !!x,
  ) as [Hex, ...Hex[]];
  const r = decodeEventLog({ abi: [def.abi], data: log.data as Hex, topics });
  for (const [k, v] of Object.entries(r.args as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? v.toLowerCase() : (v as bigint | boolean);
  }
  return out;
}
