/**
 * Minimal HTTP(S) client on node:http(s), forcing IPv4.
 *
 * AAAA lookups for *.hypersync.xyz stall for 10–15 s on the dev box, and
 * Node's global fetch offers no per-request address family. node:https with
 * `family: 4` resolves A records only. No dependency is needed.
 */
import http from "node:http";
import https from "node:https";
import { gunzipSync } from "node:zlib";

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  family: 4,
});
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 32,
  family: 4,
});

export interface HttpResponse {
  status: number;
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

/**
 * Sends one HTTP request and buffers the whole response.
 * @param url - Absolute URL
 * @param opts - Method, headers, body and timeout (ms, default 120 s)
 * @returns Status, headers and body bytes (gunzipped when the server compressed)
 */
export function httpRequest(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    timeoutMs?: number;
  } = {},
): Promise<HttpResponse> {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const lib = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: opts.method ?? "GET",
        headers: { "accept-encoding": "gzip", ...(opts.headers ?? {}) },
        agent: isHttps ? httpsAgent : httpAgent,
        family: 4,
        auth:
          u.username || u.password
            ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`
            : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let body = Buffer.concat(chunks);
          if (res.headers["content-encoding"] === "gzip") {
            body = gunzipSync(body);
          }
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(opts.timeoutMs ?? 120_000, () => {
      req.destroy(
        new Error(
          `HTTP timeout after ${opts.timeoutMs ?? 120_000} ms: ${u.host}${u.pathname}`,
        ),
      );
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/**
 * Sleeps for the given number of milliseconds.
 * @param ms - Duration
 * @returns Promise resolving after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
