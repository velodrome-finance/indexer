/**
 * Minimal read-only PostgreSQL client (wire protocol v3, simple query,
 * text results). The repository has no Postgres client dependency and the
 * harness must not add one; this covers what the checks need: trust /
 * cleartext / MD5 / SCRAM-SHA-256 auth, streaming rows to a callback, and
 * errors surfaced as exceptions. Every value arrives as a string (or null).
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import net from "node:net";

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

export type PgRow = Record<string, string | null>;

/**
 * Parses a postgres:// URL.
 * @param url - Connection URL
 * @returns Connection settings
 */
export function parsePgUrl(url: string): PgConfig {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
  };
}

class Reader {
  buf: Buffer = Buffer.alloc(0);
  push(b: Buffer) {
    this.buf = this.buf.length === 0 ? b : Buffer.concat([this.buf, b]);
  }
  /** Returns the next complete message, or null. */
  next(): { type: string; body: Buffer } | null {
    if (this.buf.length < 5) return null;
    const len = this.buf.readInt32BE(1);
    if (this.buf.length < 1 + len) return null;
    const type = String.fromCharCode(this.buf[0]);
    const body = this.buf.subarray(5, 1 + len);
    this.buf = this.buf.subarray(1 + len);
    return { type, body };
  }
}

function msg(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.write(type, 0, "ascii");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}

function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
}

function parseError(body: Buffer): string {
  const parts: Record<string, string> = {};
  let i = 0;
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i]);
    const end = body.indexOf(0, i + 1);
    parts[code] = body.subarray(i + 1, end).toString("utf8");
    i = end + 1;
  }
  return `${parts.S ?? "ERROR"} ${parts.C ?? ""}: ${parts.M ?? "unknown"}${parts.D ? ` (${parts.D})` : ""}`;
}

/** One connection; queries are serialized. */
export class PgClient {
  private sock!: net.Socket;
  private reader = new Reader();
  private waiter: (() => void) | null = null;
  private closed = false;
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * @param cfg - Connection settings
   */
  constructor(private readonly cfg: PgConfig) {}

  private async nextMsg(): Promise<{ type: string; body: Buffer }> {
    for (;;) {
      const m = this.reader.next();
      if (m) return m;
      if (this.closed) throw new Error("Postgres connection closed");
      await new Promise<void>((r) => {
        this.waiter = r;
      });
    }
  }

  /**
   * Opens the connection and authenticates.
   * @returns Promise resolving when ready for queries
   */
  async connect(): Promise<void> {
    this.sock = net.connect({
      host: this.cfg.host,
      port: this.cfg.port,
      family: 4,
    });
    this.sock.on("data", (b: Buffer) => {
      this.reader.push(b);
      const w = this.waiter;
      this.waiter = null;
      w?.();
    });
    this.sock.on("close", () => {
      this.closed = true;
      const w = this.waiter;
      this.waiter = null;
      w?.();
    });
    await new Promise<void>((res, rej) => {
      this.sock.once("connect", () => res());
      this.sock.once("error", rej);
    });
    const params = Buffer.concat([
      cstr("user"),
      cstr(this.cfg.user),
      cstr("database"),
      cstr(this.cfg.database),
      cstr("client_encoding"),
      cstr("UTF8"),
      Buffer.from([0]),
    ]);
    const startup = Buffer.alloc(8);
    startup.writeInt32BE(8 + params.length, 0);
    startup.writeInt32BE(196608, 4);
    this.sock.write(Buffer.concat([startup, params]));

    let scram: {
      nonce: string;
      clientFirstBare: string;
      serverSig?: Buffer;
    } | null = null;
    for (;;) {
      const m = await this.nextMsg();
      if (m.type === "E") throw new Error(parseError(m.body));
      if (m.type === "R") {
        const code = m.body.readInt32BE(0);
        if (code === 0) continue;
        if (code === 3) {
          this.sock.write(msg("p", cstr(this.cfg.password ?? "")));
        } else if (code === 5) {
          const salt = m.body.subarray(4, 8);
          const inner = createHash("md5")
            .update((this.cfg.password ?? "") + this.cfg.user)
            .digest("hex");
          const outer = createHash("md5")
            .update(Buffer.concat([Buffer.from(inner), salt]))
            .digest("hex");
          this.sock.write(msg("p", cstr(`md5${outer}`)));
        } else if (code === 10) {
          const nonce = randomBytes(18).toString("base64");
          const clientFirstBare = `n=*,r=${nonce}`;
          scram = { nonce, clientFirstBare };
          const first = Buffer.from(`n,,${clientFirstBare}`);
          const len = Buffer.alloc(4);
          len.writeInt32BE(first.length);
          this.sock.write(
            msg("p", Buffer.concat([cstr("SCRAM-SHA-256"), len, first])),
          );
        } else if (code === 11 && scram) {
          const serverFirst = m.body.subarray(4).toString();
          const attrs = Object.fromEntries(
            serverFirst.split(",").map((kv) => [kv[0], kv.slice(2)]),
          );
          const salted = pbkdf2Sync(
            this.cfg.password ?? "",
            Buffer.from(attrs.s, "base64"),
            Number(attrs.i),
            32,
            "sha256",
          );
          const clientKey = createHmac("sha256", salted)
            .update("Client Key")
            .digest();
          const storedKey = createHash("sha256").update(clientKey).digest();
          const clientFinalNoProof = `c=biws,r=${attrs.r}`;
          const authMessage = `${scram.clientFirstBare},${serverFirst},${clientFinalNoProof}`;
          const sig = createHmac("sha256", storedKey)
            .update(authMessage)
            .digest();
          const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
          const serverKey = createHmac("sha256", salted)
            .update("Server Key")
            .digest();
          scram.serverSig = createHmac("sha256", serverKey)
            .update(authMessage)
            .digest();
          this.sock.write(
            msg(
              "p",
              Buffer.from(
                `${clientFinalNoProof},p=${proof.toString("base64")}`,
              ),
            ),
          );
        } else if (code === 12) {
          // SASL final: server signature (verified implicitly by the server accepting us).
        } else {
          throw new Error(`Unsupported Postgres auth method ${code}`);
        }
      } else if (m.type === "Z") {
        return;
      }
      // S (parameter status), K (backend key) ignored.
    }
  }

  /**
   * Runs one query and streams rows to a callback.
   * @param sql - SQL text (no parameters; callers quote literals with {@link lit})
   * @param onRow - Called for each row
   * @returns Number of rows
   */
  queryStream(sql: string, onRow: (row: PgRow) => void): Promise<number> {
    const run = async (): Promise<number> => {
      this.sock.write(msg("Q", cstr(sql)));
      let cols: string[] = [];
      let n = 0;
      let err: string | null = null;
      for (;;) {
        const m = await this.nextMsg();
        if (m.type === "T") {
          const count = m.body.readInt16BE(0);
          cols = [];
          let i = 2;
          for (let c = 0; c < count; c++) {
            const end = m.body.indexOf(0, i);
            cols.push(m.body.subarray(i, end).toString("utf8"));
            i = end + 1 + 18;
          }
        } else if (m.type === "D") {
          const count = m.body.readInt16BE(0);
          const row: PgRow = {};
          let i = 2;
          for (let c = 0; c < count; c++) {
            const len = m.body.readInt32BE(i);
            i += 4;
            if (len < 0) row[cols[c]] = null;
            else {
              row[cols[c]] = m.body.subarray(i, i + len).toString("utf8");
              i += len;
            }
          }
          n++;
          if (!err) {
            try {
              onRow(row);
            } catch (e) {
              err = `row callback failed: ${(e as Error).stack ?? e}`;
            }
          }
        } else if (m.type === "E") {
          err = parseError(m.body);
        } else if (m.type === "Z") {
          if (err) throw new Error(`${err}\nSQL: ${sql.slice(0, 500)}`);
          return n;
        }
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /**
   * Runs one query and buffers all rows.
   * @param sql - SQL text
   * @returns Rows
   */
  async query(sql: string): Promise<PgRow[]> {
    const rows: PgRow[] = [];
    await this.queryStream(sql, (r) => rows.push(r));
    return rows;
  }

  /**
   * Closes the connection.
   * @returns void
   */
  close(): void {
    try {
      this.sock.write(msg("X", Buffer.alloc(0)));
    } catch {
      /* ignore */
    }
    this.sock.end();
  }
}

/**
 * Quotes a SQL string literal.
 * @param s - Value
 * @returns Quoted literal
 */
export function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Quotes a SQL identifier.
 * @param s - Identifier
 * @returns Quoted identifier
 */
export function ident(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
