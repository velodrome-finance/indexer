/**
 * Regression test for issue #853 (V2_RESERVE_MISMATCH false positives).
 *
 * The audit's V2 reserve check used `client.readContract({ ..., functionName:
 * "getReserves" })` without a `blockNumber`, so viem hit chain head while
 * `pool.reserve0/1` was the value the indexer had at its (older)
 * `latest_processed_block`. Any Sync between those two heights surfaced as a
 * spurious `[V2_RESERVE_MISMATCH]` NEW_REGRESSION.
 *
 * Fix: `checkPoolOnchain(pool, latestProcessedBlock)` forwards the indexer's
 * latest processed block to every RPC read so the indexer and on-chain views
 * sample the same point in time.
 *
 * This test stubs `CHAIN_CONSTANTS[10].eth_client.readContract` and asserts
 * that the pinned `blockNumber` is forwarded. Pre-fix the assertion fails
 * because `blockNumber` is undefined.
 */
import { describe, expect, it, vi } from "vitest";
import { checkPoolOnchain } from "../../scripts/integrity-audit";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";

const POOL_ADDR = toChecksumAddress(
  "0xa1055762336F92b4B8d2eDC032A0Ce45ead6280a",
);

describe("integrity-audit: checkPoolOnchain (#853)", () => {
  it("pins V2 getReserves() to the indexer's latest_processed_block", async () => {
    const readContract = vi.fn().mockResolvedValue([100n, 200n, 0n]);
    const original = CHAIN_CONSTANTS[10].eth_client;
    // Cast through unknown — the real eth_client is a viem PublicClient; we
    // only stub the one method `checkPoolOnchain` calls.
    CHAIN_CONSTANTS[10].eth_client = {
      readContract,
    } as unknown as typeof original;

    try {
      const pool = {
        id: `10-${POOL_ADDR}`,
        chainId: 10,
        poolAddress: POOL_ADDR,
        isCL: false,
        reserve0: "100",
        reserve1: "200",
        // Other PoolRow fields are unused by the V2 branch — supply minimal
        // shape via `as unknown as PoolRow` indirection inside the call.
      };

      const latestProcessedBlock = 152833367n;
      // biome-ignore lint/suspicious/noExplicitAny: minimal PoolRow stub
      await checkPoolOnchain(pool as any, latestProcessedBlock);

      expect(readContract).toHaveBeenCalledTimes(1);
      expect(readContract.mock.calls[0][0]).toMatchObject({
        functionName: "getReserves",
        blockNumber: latestProcessedBlock,
      });
    } finally {
      CHAIN_CONSTANTS[10].eth_client = original;
    }
  });
});
