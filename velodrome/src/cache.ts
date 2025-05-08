import * as fs from "fs";
import * as path from "path";

import { CacheCategory } from "./Constants";

type Address = string;

type Shape = Record<string, Record<string, any>>;

type ShapeRoot = Shape & Record<Address, { hash: string }>;
export type ShapeGuageToPool = Shape &
  Record<Address, { poolAddress: Address }>;
export type ShapeBribeToPool = Shape &
  Record<Address, { poolAddress: Address }>;
export type tokenToPricingPairs = {
  // NOTE: a set would be a better datatype than an array here - but insert only happens seldomly, so not an issue.
  poolIdsWithWhitelistedTokens: string[];
};
export type ShapeWhiteListedPoolIds = Shape &
  Record<Address, tokenToPricingPairs>;
export type ShapePoolToTokens = Shape &
  Record<Address, { token0: Address; token1: Address }>;

export type ShapePricesList = string[];

export type ShapeTokenPrices = Shape & Record<string, { prices: ShapePricesList }>;

export type ShapeToken = Shape &
  Record<Address, { decimals: number; name: string; symbol: string }>;

export class Cache {
  static init<C = CacheCategory>(
    category: C,
    chainId: number | string | bigint
  ) {
    if (!Object.values(CacheCategory).find((c) => c === category)) {
      throw new Error("Unsupported cache category");
    }

    type S = C extends "token"
      ? ShapeToken
      : C extends "guageToPool"
      ? ShapeGuageToPool
      : C extends "bribeToPool"
      ? ShapeBribeToPool
      : C extends "whitelistedPoolIds"
      ? ShapeWhiteListedPoolIds
      : C extends "poolToTokens"
      ? ShapePoolToTokens
      : C extends "tokenPrice"
      ? ShapeTokenPrices
      : ShapeRoot;
    const entry = new Entry<S>(`${category}-${chainId.toString()}`);
    return entry;
  }
}

export class Entry<T extends Shape> {
  private memory: Shape = {};

  static encoding = "utf8" as const;
  static folder = "./.cache" as const;

  public readonly key: string;
  public readonly file: string;

  constructor(key: string) {
    this.key = key;
    this.file = Entry.resolve(key);

    this.preflight();
    this.load();
  }

  public read(key: string) {
    const memory = this.memory || {};
    return memory[key] as T[typeof key];
  }

  public load() {
    try {
      const data = fs.readFileSync(this.file, Entry.encoding);
      this.memory = JSON.parse(data) as T;
    } catch (error) {
      console.error(error);
      this.memory = {};
    }
  }

  public add<N extends T>(fields: N) {
    if (!this.memory || Object.values(this.memory).length === 0) {
      this.memory = fields;
    } else {
      Object.keys(fields).forEach((key) => {
        if (!this.memory[key]) {
          this.memory[key] = {};
        }
        Object.keys(fields[key]).forEach((nested) => {
          this.memory[key][nested] = fields[key][nested];
        });
      });
    }

    this.publish();
  }

  private preflight() {
    /** Ensure cache folder exists */
    if (!fs.existsSync(Entry.folder)) {
      fs.mkdirSync(Entry.folder);
    }
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify({}));
    }
  }

  private publish() {
    const prepared = JSON.stringify(this.memory, (key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    try {
      fs.writeFileSync(this.file, prepared);
    } catch (error) {
      console.error(error);
    }
  }

  static resolve(key: string) {
    return path.join(Entry.folder, key.toLowerCase().concat(".json"));
  }
}
