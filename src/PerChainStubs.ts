/**
 * Proof-branch stubs for the cross-chain flows A–G of ADR 0009
 * (docs/adr/0009-per-chain-entities.md).
 *
 * With `disable_default_cross_chain: true` a handler only sees its own
 * chain's rows, so every flow that read or wrote another chain's rows is
 * either moved (root facts stay on the root chain, joins move to ClickHouse)
 * or, on this branch, stubbed. Each stub logs once per process and flow so a
 * run shows which stubs were reached.
 *
 * TODO(ADR 0009): delete this module once every flow is migrated.
 */

/** The cross-chain flows of ADR 0009. */
export type PerChainFlow = "A" | "B" | "C" | "D" | "E" | "F" | "G";

type Logger = { info: (message: string) => void };

const reported = new Set<PerChainFlow>();

/**
 * Logs, once per process and flow, that a stubbed cross-chain flow was
 * reached and what the stub does instead.
 *
 * @param log - The handler context's logger
 * @param flow - The ADR 0009 flow letter
 * @param message - What the stub does instead of the cross-chain read/write
 * @returns Nothing; the first call per flow logs, later calls do nothing
 */
export function logPerChainStubOnce(
  log: Logger,
  flow: PerChainFlow,
  message: string,
): void {
  if (reported.has(flow)) return;
  reported.add(flow);
  log.info(`[per-chain stub ${flow}] ${message}`);
}
