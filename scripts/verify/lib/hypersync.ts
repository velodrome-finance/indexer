/**
 * HyperSync JSON API client (POST /query, bearer token, IPv4 only).
 *
 * Pages with `next_block`: a response can stop before `to_block`, so callers
 * get one callback per page and the loop continues from `next_block` until it
 * reaches the requested end. `to_block` is exclusive, as in the API.
 */
import { requireEnv } from "./env";
import { httpRequest, sleep } from "./http";

export interface HsLog {
  block_number: number;
  log_index: number;
  transaction_index?: number;
  transaction_hash?: string;
  address: string;
  data: string;
  topic0?: string | null;
  topic1?: string | null;
  topic2?: string | null;
  topic3?: string | null;
}

export interface HsBlock {
  number: number;
  timestamp: string | number;
}

export interface HsTransaction {
  hash: string;
  from?: string;
  to?: string | null;
  block_number?: number;
  transaction_index?: number;
}

export interface HsLogSelection {
  address?: string[];
  topics?: (string[] | null)[];
}

export interface HsQuery {
  from_block: number;
  to_block?: number;
  logs?: HsLogSelection[];
  transactions?: unknown[];
  blocks?: unknown[];
  include_all_blocks?: boolean;
  field_selection: {
    log?: string[];
    block?: string[];
    transaction?: string[];
  };
  max_num_logs?: number;
  max_num_blocks?: number;
  join_mode?: string;
}

export interface HsPage {
  logs: HsLog[];
  blocks: HsBlock[];
  transactions: HsTransaction[];
  nextBlock: number;
  archiveHeight: number | null;
}

interface RawResponse {
  data: {
    logs?: HsLog[];
    blocks?: HsBlock[];
    transactions?: HsTransaction[];
  }[];
  archive_height: number | null;
  next_block: number;
}

/** Per-process HyperSync usage counters (for the report). */
export const hypersyncStats = { requests: 0, logs: 0, bytes: 0 };

/**
 * Base URL of a chain's HyperSync endpoint.
 * @param chainId - EVM chain id
 * @param override - Explicit URL from config.yaml `hypersync_config.url`, if any
 * @returns Base URL without trailing slash
 */
export function hypersyncUrl(chainId: number, override?: string): string {
  return (override ?? `https://${chainId}.hypersync.xyz`).replace(/\/$/, "");
}

/**
 * Current archive height of a chain.
 * @param baseUrl - HyperSync base URL
 * @returns Latest block number HyperSync can serve
 */
export async function hypersyncHeight(baseUrl: string): Promise<number> {
  const token = requireEnv("ENVIO_API_TOKEN");
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await httpRequest(`${baseUrl}/height`, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: 30_000,
      });
      if (res.status !== 200)
        throw new Error(
          `HTTP ${res.status}: ${res.body.toString().slice(0, 200)}`,
        );
      return JSON.parse(res.body.toString()).height as number;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function querySingle(baseUrl: string, q: HsQuery): Promise<RawResponse> {
  const token = requireEnv("ENVIO_API_TOKEN");
  const body = JSON.stringify(q);
  for (let attempt = 0; ; attempt++) {
    try {
      hypersyncStats.requests++;
      const res = await httpRequest(`${baseUrl}/query`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body,
        timeoutMs: 180_000,
      });
      hypersyncStats.bytes += res.body.length;
      if (res.status === 200)
        return JSON.parse(res.body.toString()) as RawResponse;
      const msg = `HyperSync HTTP ${res.status}: ${res.body.toString().slice(0, 300)}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429)
        throw new Error(`FATAL ${msg}`);
      throw new Error(msg);
    } catch (e) {
      const m = (e as Error).message;
      if (m.startsWith("FATAL") || attempt >= 8) throw e;
      await sleep(Math.min(30_000, 1000 * 2 ** attempt));
    }
  }
}

/**
 * Streams a query page by page from `from_block` to `to_block` (exclusive).
 * @param baseUrl - HyperSync base URL
 * @param q - Query; `to_block` is required
 * @param onPage - Called with each page, in block order
 * @returns Promise resolving when the range is exhausted
 */
export async function hypersyncStream(
  baseUrl: string,
  q: HsQuery & { to_block: number },
  onPage: (page: HsPage) => void | Promise<void>,
): Promise<void> {
  let from = q.from_block;
  while (from < q.to_block) {
    const res = await querySingle(baseUrl, { ...q, from_block: from });
    const page: HsPage = {
      logs: [],
      blocks: [],
      transactions: [],
      nextBlock: res.next_block,
      archiveHeight: res.archive_height,
    };
    for (const d of res.data ?? []) {
      if (d.logs) for (const l of d.logs) page.logs.push(l);
      if (d.blocks) for (const b of d.blocks) page.blocks.push(b);
      if (d.transactions)
        for (const t of d.transactions) page.transactions.push(t);
    }
    hypersyncStats.logs += page.logs.length;
    await onPage(page);
    if (res.next_block <= from) {
      throw new Error(
        `HyperSync did not advance (from=${from}, next=${res.next_block}); archive height ${res.archive_height}`,
      );
    }
    from = res.next_block;
  }
}

/**
 * Like {@link hypersyncStream}, but fetches `segments` contiguous block ranges
 * concurrently and still delivers pages strictly in block order. Each segment
 * buffers at most `maxBuffered` pages ahead of the consumer.
 * @param baseUrl - HyperSync base URL
 * @param q - Query; `to_block` is required
 * @param onPage - Called with each page, in block order
 * @param segments - Number of concurrent range segments (default 6)
 * @param maxBuffered - Pages buffered per segment (default 40)
 * @returns Promise resolving when the range is exhausted
 */
export async function hypersyncStreamParallel(
  baseUrl: string,
  q: HsQuery & { to_block: number },
  onPage: (page: HsPage) => void | Promise<void>,
  segments = 6,
  maxBuffered = 40,
): Promise<void> {
  const span = q.to_block - q.from_block;
  if (span <= 0) return;
  const n = Math.max(1, Math.min(segments, Math.ceil(span / 10_000)));
  const bounds: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = q.from_block + Math.floor((span * i) / n);
    const b = q.from_block + Math.floor((span * (i + 1)) / n);
    if (b > a) bounds.push([a, b]);
  }
  type Seg = {
    pages: HsPage[];
    done: boolean;
    error?: unknown;
    wake?: () => void;
    space?: () => void;
  };
  const segs: Seg[] = bounds.map(() => ({ pages: [], done: false }));
  bounds.forEach(([a, b], i) => {
    const s = segs[i];
    hypersyncStream(
      baseUrl,
      { ...q, from_block: a, to_block: b },
      async (p) => {
        s.pages.push(p);
        s.wake?.();
        while (s.pages.length >= maxBuffered) {
          await new Promise<void>((r) => {
            s.space = r;
          });
        }
      },
    )
      .then(() => {
        s.done = true;
        s.wake?.();
      })
      .catch((e) => {
        s.error = e;
        s.done = true;
        s.wake?.();
      });
  });
  for (const s of segs) {
    for (;;) {
      if (s.error) throw s.error;
      const p = s.pages.shift();
      if (p) {
        const sp = s.space;
        s.space = undefined;
        sp?.();
        await onPage(p);
        continue;
      }
      if (s.done) break;
      await new Promise<void>((r) => {
        s.wake = r;
      });
      s.wake = undefined;
    }
  }
}

/**
 * Timestamp of one block.
 * @param baseUrl - HyperSync base URL
 * @param block - Block number
 * @returns Unix seconds
 */
export async function hypersyncBlockTimestamp(
  baseUrl: string,
  block: number,
): Promise<number> {
  let ts: number | undefined;
  await hypersyncStream(
    baseUrl,
    {
      from_block: block,
      to_block: block + 1,
      include_all_blocks: true,
      field_selection: { block: ["number", "timestamp"] },
    },
    (p) => {
      for (const b of p.blocks)
        if (b.number === block) ts = parseHsTimestamp(b.timestamp);
    },
  );
  if (ts === undefined) throw new Error(`No block ${block} from ${baseUrl}`);
  return ts;
}

/** Standard field selection for decoded event processing. */
export const LOG_FIELDS = [
  "block_number",
  "log_index",
  "transaction_index",
  "transaction_hash",
  "address",
  "data",
  "topic0",
  "topic1",
  "topic2",
  "topic3",
];

/**
 * Parses a HyperSync block timestamp (hex string or number) to seconds.
 * @param ts - Timestamp as returned by HyperSync
 * @returns Unix seconds
 */
export function parseHsTimestamp(ts: string | number): number {
  return typeof ts === "number" ? ts : Number(BigInt(ts));
}
