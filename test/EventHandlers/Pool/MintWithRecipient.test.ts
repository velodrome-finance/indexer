import { createTestIndexer } from "envio";
import {
  PoolTransferInTxId,
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  TxPoolTransferRegistryId,
  UserStatsPerPoolId,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import { calculateTotalUSD } from "../../../src/Helpers";
import { setupCommon } from "./common";

// #886: superchain-leaf V2 pools emit a 4-arg Mint(sender, to, amount0, amount1)
// instead of the canonical 3-arg Mint, so the canonical Pool.Mint handler never
// fired on those chains and per-LP totalLiquidityAdded* counters stayed 0. The
// MintWithRecipient handler attributes directly to `to` — no Transfer matching.
describe("Pool MintWithRecipient Event (#886 superchain-leaf 4-arg Mint)", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  let commonData: ReturnType<typeof setupCommon>;

  const chainId = 10 as const;
  const recipient = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  const sender = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const amount0 = 1000n * TEN_TO_THE_18_BI; // token0 has 18 decimals, $1 -> $1000
  const amount1 = 2000n * TEN_TO_THE_6_BI; // token1 has 6 decimals, $1 -> $2000

  beforeEach(() => {
    indexer = createTestIndexer();
    commonData = setupCommon();

    indexer.Pool.set(commonData.mockLiquidityPoolData);
    indexer.Token.set(commonData.mockToken0Data);
    indexer.Token.set(commonData.mockToken1Data);
  });

  async function processMint() {
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "Pool",
              event: "MintWithRecipient",
              srcAddress: commonData.mockLiquidityPoolData
                .poolAddress as `0x${string}`,
              logIndex: 1,
              block: {
                timestamp: 1000000,
                number: 123456,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              params: { sender, to: recipient, amount0, amount1 },
            },
          ],
        },
      },
    });
  }

  it("populates the recipient's added liquidity counters without a preceding Transfer", async () => {
    await processMint();

    const userStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(
        chainId,
        recipient,
        commonData.mockLiquidityPoolData.poolAddress,
      ),
    );

    expect(userStats).toBeDefined();
    // Raw token amounts (#810) come straight from the event — the core fix.
    expect(userStats?.totalLiquidityAddedToken0).toBe(amount0);
    expect(userStats?.totalLiquidityAddedToken1).toBe(amount1);
    // USD is the normalized sum of both legs: $1000 + $2000 = $3000.
    const expectedUSD = calculateTotalUSD(
      amount0,
      amount1,
      commonData.mockToken0Data,
      commonData.mockToken1Data,
    );
    expect(userStats?.totalLiquidityAddedUSD).toBe(expectedUSD);
    expect(userStats?.totalLiquidityAddedUSD).toBe(3000n * TEN_TO_THE_18_BI);
    // Removed counters untouched by a Mint.
    expect(userStats?.totalLiquidityRemovedToken0).toBe(0n);
    expect(userStats?.totalLiquidityRemovedToken1).toBe(0n);
  });

  it("attributes to `to`, not the `sender` (router)", async () => {
    await processMint();

    const senderStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(
        chainId,
        sender,
        commonData.mockLiquidityPoolData.poolAddress,
      ),
    );
    expect(senderStats).toBeUndefined();
  });

  it("purges the mint-side PoolTransferInTx + registry rows for its tx (no leaf leak)", async () => {
    const txHash = `0x${"ab".repeat(32)}`;
    const pool = commonData.mockLiquidityPoolData.poolAddress;

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            // 1) LP-token mint Transfer (from 0x0) — records a PoolTransferInTx
            //    row + registry entry for the (never-firing on leaf) 3-arg Mint.
            {
              contract: "Pool",
              event: "Transfer",
              srcAddress: pool as `0x${string}`,
              logIndex: 0,
              block: {
                timestamp: 1000000,
                number: 123456,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              transaction: { hash: txHash },
              params: {
                from: ZERO_ADDRESS,
                to: recipient,
                value: 500n * TEN_TO_THE_18_BI,
              },
            },
            // 2) The 4-arg leaf Mint in the same tx.
            {
              contract: "Pool",
              event: "MintWithRecipient",
              srcAddress: pool as `0x${string}`,
              logIndex: 1,
              block: {
                timestamp: 1000000,
                number: 123456,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              transaction: { hash: txHash },
              params: { sender, to: recipient, amount0, amount1 },
            },
          ],
        },
      },
    });

    // The mint Transfer row and its registry entry must be purged — otherwise
    // they would accumulate forever on leaf chains.
    expect(
      await indexer.PoolTransferInTx.get(
        PoolTransferInTxId(chainId, txHash, pool, 0),
      ),
    ).toBeUndefined();
    expect(
      await indexer.TxPoolTransferRegistry.get(
        TxPoolTransferRegistryId(chainId, txHash, pool),
      ),
    ).toBeUndefined();

    // Attribution still happened.
    const userStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, recipient, pool),
    );
    expect(userStats?.totalLiquidityAddedToken0).toBe(amount0);
  });

  it("bumps the pool activity timestamp but leaves reserves to Sync", async () => {
    await processMint();

    const { rehydrateTimestamps } = await import(
      "../../../src/EntityTimestamps"
    );
    const raw = await indexer.Pool.get(commonData.mockLiquidityPoolData.id);
    const updatedAggregator = raw
      ? rehydrateTimestamps("Pool", raw)
      : undefined;

    expect(updatedAggregator?.lastUpdatedTimestamp).toEqual(
      new Date(1000000 * 1000),
    );
    // Reserves are owned by Sync, never by Mint.
    expect(updatedAggregator?.reserve0).toBe(
      commonData.mockLiquidityPoolData.reserve0,
    );
    expect(updatedAggregator?.reserve1).toBe(
      commonData.mockLiquidityPoolData.reserve1,
    );
  });
});
