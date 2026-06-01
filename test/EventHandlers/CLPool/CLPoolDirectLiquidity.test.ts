import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  UserStatsPerPoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

// Issue #790: direct (non-NFPM) CLPool.Mint/Burn flows must be attributed to the
// minting owner's UserStatsPerPool, while NFPM-routed mints (owner === pool.nfpmAddress)
// stay untouched — they are credited to the real holder via NFPM.Transfer/IncreaseLiquidity.
describe("CLPool direct (non-NFPM) liquidity attribution (#790)", () => {
  const { mockToken0Data, mockToken1Data, createMockPool, defaultNfpmAddress } =
    setupCommon();

  const chainId = 10 as const;
  // A vault/strategy that calls CLPool.mint() directly (the issue's real example owner).
  const vaultOwner = toChecksumAddress(
    "0xa0f688905ef05ea853c35131b4899a613b4ba644",
  );
  const txHash =
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const blockHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";

  // token0 has 18 decimals @ $1, token1 has 6 decimals @ $1 (see common.ts).
  const amount0 = 500n * TEN_TO_THE_18_BI;
  const amount1 = 300n * TEN_TO_THE_6_BI;
  // Trust-gated USD: normalize each leg to 1e18-base @ $1 → 500e18 + 300e18.
  const expectedUSD = 800n * TEN_TO_THE_18_BI;

  let indexer: ReturnType<typeof createTestIndexer>;
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    indexer = createTestIndexer();
    // CL pool → createMockPool defaults nfpmAddress to defaultNfpmAddress.
    pool = createMockPool({ isCL: true });
    indexer.Pool.set(pool);
    indexer.Token.set(mockToken0Data as Token);
    indexer.Token.set(mockToken1Data as Token);
  });

  it("attributes a direct Mint to the owner's UserStatsPerPool added-flow", async () => {
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLPool",
              event: "Mint",
              srcAddress: pool.poolAddress as `0x${string}`,
              logIndex: 1,
              block: { timestamp: 1000000, number: 123456, hash: blockHash },
              transaction: { hash: txHash },
              params: {
                owner: vaultOwner,
                tickLower: -100000n,
                tickUpper: 100000n,
                amount: 1000000n,
                amount0,
                amount1,
              },
            },
          ],
        },
      },
    });

    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, vaultOwner, pool.poolAddress),
    );
    expect(stats).toBeDefined();
    expect(stats?.totalLiquidityAddedToken0).toBe(amount0);
    expect(stats?.totalLiquidityAddedToken1).toBe(amount1);
    expect(stats?.totalLiquidityAddedUSD).toBe(expectedUSD);

    // AC#3: pool reserves/TVL behavior is unchanged — reserves still increment.
    const updatedPool = await indexer.Pool.get(pool.id);
    expect(updatedPool?.reserve0).toBe(pool.reserve0 + amount0);
    expect(updatedPool?.reserve1).toBe(pool.reserve1 + amount1);
  });

  it("does NOT attribute an NFPM-routed Mint to the NFPM address (no double-count)", async () => {
    // owner === pool.nfpmAddress → this mint is the NFPM's, already credited to
    // the real holder via NFPM.Transfer/IncreaseLiquidity. Attributing here would
    // create a bogus row on the NFPM contract and double-count the flow.
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLPool",
              event: "Mint",
              srcAddress: pool.poolAddress as `0x${string}`,
              logIndex: 1,
              block: { timestamp: 1000000, number: 123456, hash: blockHash },
              transaction: { hash: txHash },
              params: {
                owner: defaultNfpmAddress,
                tickLower: -100000n,
                tickUpper: 100000n,
                amount: 1000000n,
                amount0,
                amount1,
              },
            },
          ],
        },
      },
    });

    const nfpmStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, defaultNfpmAddress, pool.poolAddress),
    );
    expect(nfpmStats).toBeUndefined();
  });

  it("attributes a direct mint-then-burn to matching added/removed flows", async () => {
    // AC#4: a direct (owner ∉ NFPM) mint followed by a burn of the same size by
    // the same owner produces equal added and removed flows.
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLPool",
              event: "Mint",
              srcAddress: pool.poolAddress as `0x${string}`,
              logIndex: 1,
              block: { timestamp: 1000000, number: 123456, hash: blockHash },
              transaction: { hash: txHash },
              params: {
                owner: vaultOwner,
                tickLower: -100000n,
                tickUpper: 100000n,
                amount: 1000000n,
                amount0,
                amount1,
              },
            },
            {
              contract: "CLPool",
              event: "Burn",
              srcAddress: pool.poolAddress as `0x${string}`,
              logIndex: 2,
              block: { timestamp: 1000100, number: 123457, hash: blockHash },
              transaction: { hash: txHash },
              params: {
                owner: vaultOwner,
                tickLower: -100000n,
                tickUpper: 100000n,
                amount: 1000000n,
                amount0,
                amount1,
              },
            },
          ],
        },
      },
    });

    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, vaultOwner, pool.poolAddress),
    );
    expect(stats).toBeDefined();
    expect(stats?.totalLiquidityAddedToken0).toBe(amount0);
    expect(stats?.totalLiquidityAddedToken1).toBe(amount1);
    expect(stats?.totalLiquidityAddedUSD).toBe(expectedUSD);
    // Burn flow mirrors the mint flow → added === removed.
    expect(stats?.totalLiquidityRemovedToken0).toBe(amount0);
    expect(stats?.totalLiquidityRemovedToken1).toBe(amount1);
    expect(stats?.totalLiquidityRemovedUSD).toBe(expectedUSD);
  });

  it("skips attribution when the pool's nfpmAddress is unmapped (null)", async () => {
    // Two CL factories are not yet mapped to an NFPM in Constants.ts, so their
    // pools carry a null nfpmAddress. We then cannot tell a direct mint from an
    // NFPM-routed one, so the gate conservatively skips attribution rather than
    // risk crediting an NFPM-routed flow to the wrong row (AC#2). Self-heals
    // once the factory→NFPM mapping is added.
    const unmappedPool = { ...pool, nfpmAddress: undefined };
    indexer.Pool.set(unmappedPool);

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLPool",
              event: "Mint",
              srcAddress: pool.poolAddress as `0x${string}`,
              logIndex: 1,
              block: { timestamp: 1000000, number: 123456, hash: blockHash },
              transaction: { hash: txHash },
              params: {
                owner: vaultOwner,
                tickLower: -100000n,
                tickUpper: 100000n,
                amount: 1000000n,
                amount0,
                amount1,
              },
            },
          ],
        },
      },
    });

    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, vaultOwner, pool.poolAddress),
    );
    expect(stats).toBeUndefined();
  });
});
