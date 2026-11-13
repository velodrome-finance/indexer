/**
 * Read access to an indexer instance (Postgres for current state and envio's
 * own bookkeeping, ClickHouse for snapshots and history).
 */
import { ChClient } from "./clickhouse";
import { PgClient, type PgRow, ident, lit } from "./pg";
import type { Target } from "./target";

export interface ChainProgress {
  chainId: number;
  progressBlock: number;
  eventsProcessed: number;
  startBlock: number;
  endBlock: number | null;
  readyAt: string | null;
}

/** Connection bundle for one target. */
export class Indexed {
  readonly pg: PgClient;
  readonly ch?: ChClient;
  private colCache = new Map<string, Set<string>>();

  /**
   * @param target - Target settings
   */
  constructor(readonly target: Target) {
    this.pg = new PgClient(target.pg);
    if (target.ch) this.ch = new ChClient(target.ch);
  }

  /**
   * Opens the Postgres connection.
   * @returns Promise resolving when connected
   */
  async connect(): Promise<void> {
    await this.pg.connect();
  }

  /**
   * Closes connections.
   * @returns void
   */
  close(): void {
    this.pg.close();
  }

  /**
   * Schema-qualified table name.
   * @param t - Table
   * @returns SQL identifier
   */
  tbl(t: string): string {
    return `${ident(this.target.pgSchema)}.${ident(t)}`;
  }

  /**
   * Columns of a Postgres table.
   * @param t - Table name
   * @returns Column names
   */
  async columns(t: string): Promise<Set<string>> {
    let c = this.colCache.get(t);
    if (!c) {
      const rows = await this.pg.query(
        `select column_name from information_schema.columns where table_schema=${lit(this.target.pgSchema)} and table_name=${lit(t)}`,
      );
      c = new Set(rows.map((r) => r.column_name as string));
      this.colCache.set(t, c);
    }
    return c;
  }

  /**
   * Per-chain progress from envio_chains.
   * @returns Progress rows
   */
  async progress(): Promise<ChainProgress[]> {
    const rows = await this.pg.query(
      `select * from ${this.tbl("envio_chains")}`,
    );
    return rows.map((r) => ({
      chainId: Number(r.id),
      progressBlock: Number(r.progress_block),
      eventsProcessed: Number(r.events_processed),
      startBlock: Number(r.start_block),
      endBlock: r.end_block === null ? null : Number(r.end_block),
      readyAt: r.ready_at,
    }));
  }

  /**
   * All rows of an entity table for one chain (by `chainId` column, or by id prefix).
   * @param table - Entity table
   * @param chainId - Chain
   * @returns Rows
   */
  async rowsForChain(table: string, chainId: number): Promise<PgRow[]> {
    const cols = await this.columns(table);
    const where = cols.has("chainId")
      ? `"chainId" = ${chainId}`
      : `id like ${lit(`${chainId}-%`)}`;
    return this.pg.query(`select * from ${this.tbl(table)} where ${where}`);
  }

  /**
   * Streams rows of an entity table for one chain.
   * @param table - Entity table
   * @param chainId - Chain
   * @param fn - Row callback
   * @returns Row count
   */
  async streamForChain(
    table: string,
    chainId: number,
    fn: (r: PgRow) => void,
  ): Promise<number> {
    const cols = await this.columns(table);
    const where = cols.has("chainId")
      ? `"chainId" = ${chainId}`
      : `id like ${lit(`${chainId}-%`)}`;
    return this.pg.queryStream(
      `select * from ${this.tbl(table)} where ${where}`,
      fn,
    );
  }

  /**
   * Dynamic contract registrations envio recorded for a chain.
   * @param chainId - Chain
   * @returns address (lowercase) -> { contract, registrationBlock }[]
   */
  async registrations(
    chainId: number,
  ): Promise<Map<string, { contract: string; block: number }[]>> {
    const rows = await this.pg.query(
      `select encode(a.address, 'hex') as address, c.name as contract, a.registration_block as block
       from ${this.tbl("envio_addresses")} a join ${this.tbl("envio_contracts")} c on c.id = a.contract_id
       where a.chain_id = ${chainId}`,
    );
    const out = new Map<string, { contract: string; block: number }[]>();
    for (const r of rows) {
      const a = `0x${r.address}`;
      const list = out.get(a) ?? [];
      list.push({ contract: r.contract as string, block: Number(r.block) });
      out.set(a, list);
    }
    return out;
  }

  /**
   * Highest ClickHouse checkpoint id of a chain at or below a block.
   * @param chainId - Chain
   * @param block - Block
   * @returns Checkpoint id (0 when none)
   */
  async chCheckpointAt(chainId: number, block: number): Promise<bigint> {
    if (!this.ch) throw new Error("no ClickHouse configured");
    const r = await this.ch.query(
      `SELECT max(id) AS id FROM envio_checkpoints WHERE chain_id = ${chainId} AND block_number <= ${block}`,
    );
    return BigInt(r[0]?.id ?? "0");
  }
}
