import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  AERO_NFPM_ADDRESS,
  AeroNFPMMintPoolId,
  NFPMCollectFeesInTxId,
  NonFungiblePositionId,
  POOL_DEPLOYMENT,
  PoolId,
  TokenId,
  UserStatsPerPoolId,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import "../../eventHandlersRegistration";
import { registerAeroCLPools } from "../../registerDynamicContracts";
import { setupCommon } from "../Pool/common";

// Aero NFPM positions (ADR 0005): created from the NFPM's own
// IncreaseLiquidity (which carries the range), with the pool handed over by the
// CLPool.Mint it caused; fees credited to the owner via NFPM.Collect.
describe("AeroNFPM positions", () => {
  const { mockToken0Data, mockToken1Data, createMockPool } = setupCommon();
  const chainId = 5042 as const; // Arc: Aero only
  const poolAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const otherPool = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  const user = toChecksumAddress("0xa0f688905ef05ea853c35131b4899a613b4ba644");
  const user2 = toChecksumAddress("0xb0f688905ef05ea853c35131b4899a613b4ba645");
  const nfpm = AERO_NFPM_ADDRESS as `0x${string}`;
  const tickLower = -600n;
  const tickUpper = 600n;
  const L = 1_000_000n;
  const a0 = 500n * 10n ** 18n;
  const a1 = 300n * 10n ** 6n;
  let blockNo = 30_000_000;
  const nextBlock = () => {
    blockNo += 10;
    return {
      number: blockNo,
      timestamp: 1_790_000_000 + blockNo,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };
  };
  const tx = (n: number) => ({
    hash: `0x${n.toString(16).padStart(64, "0")}`,
  });

  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(async () => {
    indexer = createTestIndexer();
    await registerAeroCLPools(indexer, chainId, [poolAddress, otherPool]);
    for (const t of [mockToken0Data, mockToken1Data]) {
      indexer.Token.set({
        ...t,
        id: TokenId(chainId, t.address),
        chainId,
      } as Token);
    }
    for (const p of [poolAddress, otherPool]) {
      indexer.Pool.set(
        createMockPool({
          chainId,
          poolAddress: p,
          isCL: true,
          deployment: POOL_DEPLOYMENT.AERO,
          nfpmAddress: AERO_NFPM_ADDRESS,
          token0_id: TokenId(chainId, mockToken0Data.address),
          token1_id: TokenId(chainId, mockToken1Data.address),
          tickSpacing: 100n,
          reserve0: 0n,
          reserve1: 0n,
        }),
      );
    }
  });

  function clMint(
    pool: string,
    logIndex: number,
    block: ReturnType<typeof nextBlock>,
    transaction: ReturnType<typeof tx>,
    liquidity = L,
    amount0 = a0,
    amount1 = a1,
  ) {
    return {
      contract: "CLPool" as const,
      event: "Mint" as const,
      srcAddress: pool as `0x${string}`,
      logIndex,
      block,
      transaction,
      params: {
        sender: nfpm,
        owner: nfpm,
        tickLower,
        tickUpper,
        amount: liquidity,
        amount0,
        amount1,
      },
    };
  }
  function nfpmEvent<E extends string, P>(
    event: E,
    logIndex: number,
    block: ReturnType<typeof nextBlock>,
    transaction: ReturnType<typeof tx>,
    params: P,
  ) {
    return {
      contract: "AeroNFPM" as const,
      event,
      srcAddress: nfpm,
      logIndex,
      block,
      transaction,
      params,
    };
  }
  async function run(simulate: unknown[]) {
    // biome-ignore lint/suspicious/noExplicitAny: simulate items for several contracts
    await indexer.process({ chains: { [chainId]: { simulate } } as any });
  }

  async function mintPosition(
    tokenId: bigint,
    owner = user,
    pool = poolAddress,
  ) {
    const block = nextBlock();
    const t = tx(Number(tokenId) + 1000);
    await run([
      clMint(pool, 1, block, t),
      nfpmEvent("Transfer", 2, block, t, {
        from: ZERO_ADDRESS,
        to: owner,
        tokenId,
      }),
      nfpmEvent("IncreaseLiquidity", 3, block, t, {
        tokenId,
        liquidity: L,
        amount0: a0,
        amount1: a1,
        tickLower,
        tickUpper,
      }),
    ]);
    return t;
  }

  it("creates the position from IncreaseLiquidity with the pool of the matching CLPool.Mint", async () => {
    const t = await mintPosition(7n);
    const position = await indexer.NonFungiblePosition.get(
      NonFungiblePositionId(chainId, AERO_NFPM_ADDRESS, 7n),
    );
    expect(position).toMatchObject({
      pool: poolAddress,
      owner: user,
      tickLower,
      tickUpper,
      liquidity: L,
      nfpmAddress: AERO_NFPM_ADDRESS,
      mintLogIndex: 1,
      mintTransactionHash: t.hash,
      token0: mockToken0Data.address,
      token1: mockToken1Data.address,
      isStakedInGauge: false,
    });
    // Correlation rows are consumed.
    expect(
      await indexer.AeroNFPMMintPool.get(
        AeroNFPMMintPoolId(
          chainId,
          t.hash,
          AERO_NFPM_ADDRESS,
          tickLower,
          tickUpper,
          L,
          a0,
          a1,
        ),
      ),
    ).toBeUndefined();
    expect(
      await indexer.AeroNFPMPendingMint.get(
        NonFungiblePositionId(chainId, AERO_NFPM_ADDRESS, 7n),
      ),
    ).toBeUndefined();
    // Added liquidity credited to the holder, never to the NFPM contract.
    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, user, poolAddress),
    );
    expect(stats?.totalLiquidityAddedToken0).toBe(a0);
    expect(stats?.totalLiquidityAddedToken1).toBe(a1);
    expect(
      await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, AERO_NFPM_ADDRESS, poolAddress),
      ),
    ).toBeUndefined();
    // No legacy correlation rows for Aero pools.
    expect(
      await indexer.CLPoolMintEvent.getWhere({
        transactionHash: { _eq: t.hash },
      }),
    ).toEqual([]);
  });

  it("adds liquidity to an existing position and drops the correlation row", async () => {
    await mintPosition(7n);
    const block = nextBlock();
    const t = tx(99);
    await run([
      clMint(poolAddress, 5, block, t, 2n * L, a0, a1),
      nfpmEvent("IncreaseLiquidity", 6, block, t, {
        tokenId: 7n,
        liquidity: 2n * L,
        amount0: a0,
        amount1: a1,
        tickLower,
        tickUpper,
      }),
    ]);
    const position = await indexer.NonFungiblePosition.get(
      NonFungiblePositionId(chainId, AERO_NFPM_ADDRESS, 7n),
    );
    expect(position?.liquidity).toBe(3n * L);
    expect(
      await indexer.AeroNFPMMintPool.get(
        AeroNFPMMintPoolId(
          chainId,
          t.hash,
          AERO_NFPM_ADDRESS,
          tickLower,
          tickUpper,
          2n * L,
          a0,
          a1,
        ),
      ),
    ).toBeUndefined();
    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, user, poolAddress),
    );
    expect(stats?.totalLiquidityAddedToken0).toBe(2n * a0);
  });

  it("matches two mints in one tx to their own pools", async () => {
    const block = nextBlock();
    const t = tx(4242);
    // Same range in both pools, different amounts: each IncreaseLiquidity
    // finds its own pool by key.
    await run([
      clMint(poolAddress, 1, block, t, L, a0, a1),
      nfpmEvent("Transfer", 2, block, t, {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 11n,
      }),
      nfpmEvent("IncreaseLiquidity", 3, block, t, {
        tokenId: 11n,
        liquidity: L,
        amount0: a0,
        amount1: a1,
        tickLower,
        tickUpper,
      }),
      clMint(otherPool, 4, block, t, L + 1n, a0, a1),
      nfpmEvent("Transfer", 5, block, t, {
        from: ZERO_ADDRESS,
        to: user2,
        tokenId: 12n,
      }),
      nfpmEvent("IncreaseLiquidity", 6, block, t, {
        tokenId: 12n,
        liquidity: L + 1n,
        amount0: a0,
        amount1: a1,
        tickLower,
        tickUpper,
      }),
    ]);
    const p11 = await indexer.NonFungiblePosition.get(
      NonFungiblePositionId(chainId, AERO_NFPM_ADDRESS, 11n),
    );
    const p12 = await indexer.NonFungiblePosition.get(
      NonFungiblePositionId(chainId, AERO_NFPM_ADDRESS, 12n),
    );
    expect(p11?.pool).toBe(poolAddress);
    expect(p11?.owner).toBe(user);
    expect(p12?.pool).toBe(otherPool);
    expect(p12?.owner).toBe(user2);
    expect(p12?.mintLogIndex).toBe(4);
  });

  it("creates no position when no CLPool.Mint matches", async () => {
    const block = nextBlock();
    const t = tx(5151);
    await run([
      nfpmEvent("Transfer", 2, block, t, {
        from: ZERO_ADDRESS,
        to: user,
        tokenId: 21n,
      }),
      nfpmEvent("IncreaseLiquidity", 3, block, t, {
        tokenId: 21n,
        liquidity: L,
        amount0: a0,
        amount1: a1,
        tickLower,
        tickUpper,
      }),
    ]);
    expect(
      await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, AERO_NFPM_ADDRESS, 21n),
      ),
    ).toBeUndefined();
  });

  it("credits Collect fees (collected minus decreased principal) to the owner, not the NFPM", async () => {
    await mintPosition(7n);
    const block = nextBlock();
    const t = tx(777);
    const d0 = a0 / 2n;
    const d1 = a1 / 2n;
    const f0 = 3n * 10n ** 18n;
    const f1 = 2n * 10n ** 6n;
    await run([
      {
        contract: "CLPool" as const,
        event: "Burn" as const,
        srcAddress: poolAddress,
        logIndex: 1,
        block,
        transaction: t,
        params: {
          owner: nfpm,
          tickLower,
          tickUpper,
          amount: L / 2n,
          amount0: d0,
          amount1: d1,
        },
      },
      nfpmEvent("DecreaseLiquidity", 2, block, t, {
        tokenId: 7n,
        liquidity: L / 2n,
        amount0: d0,
        amount1: d1,
      }),
      {
        contract: "CLPool" as const,
        event: "Collect" as const,
        srcAddress: poolAddress,
        logIndex: 3,
        block,
        transaction: t,
        params: {
          owner: nfpm,
          recipient: user,
          tickLower,
          tickUpper,
          amount0: d0 + f0,
          amount1: d1 + f1,
        },
      },
      nfpmEvent("Collect", 4, block, t, {
        tokenId: 7n,
        recipient: user,
        amount0: d0 + f0,
        amount1: d1 + f1,
      }),
    ]);
    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, user, poolAddress),
    );
    expect(stats?.totalUnstakedFeesCollected0).toBe(f0);
    expect(stats?.totalUnstakedFeesCollected1).toBe(f1);
    expect(stats?.totalLiquidityRemovedToken0).toBe(d0);
    // Pool-level fee totals still come from CLPool.Collect.
    const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
    expect(pool?.totalUnstakedFeesCollected0).toBe(
      createMockPool().totalUnstakedFeesCollected0 + f0,
    );
    // The NFPM contract gets no user row.
    expect(
      await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, AERO_NFPM_ADDRESS, poolAddress),
      ),
    ).toBeUndefined();
    // The fee hand-over was consumed by the NFPM's Collect.
    expect(
      await indexer.NFPMCollectFeesInTx.get(
        NFPMCollectFeesInTxId(chainId, t.hash, AERO_NFPM_ADDRESS),
      ),
    ).toBeUndefined();
  });

  // The NFPM's Collect reports the amounts it asked the pool for, which can
  // exceed what the pool paid by a few wei. Real Arc tx 0x2e1346d0…ca1a (pool
  // 0x5e4d45a3…f922, tokenId 3094): CLPool.Collect paid 67324196766282 / 83,
  // the Aero NFPM's Collect says 67324196766282 / 84.
  it("credits the owner exactly what the pool paid, not the NFPM's requested amount", async () => {
    await mintPosition(3094n);
    const block = nextBlock();
    const t = tx(2994);
    const paid0 = 67324196766282n;
    const paid1 = 83n;
    await run([
      {
        contract: "CLPool" as const,
        event: "Collect" as const,
        srcAddress: poolAddress,
        logIndex: 3,
        block,
        transaction: t,
        params: {
          owner: nfpm,
          recipient: user,
          tickLower,
          tickUpper,
          amount0: paid0,
          amount1: paid1,
        },
      },
      nfpmEvent("Collect", 5, block, t, {
        tokenId: 3094n,
        recipient: user,
        amount0: paid0,
        amount1: paid1 + 1n,
      }),
    ]);
    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, user, poolAddress),
    );
    const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
    expect(stats?.totalUnstakedFeesCollected0).toBe(paid0);
    expect(stats?.totalUnstakedFeesCollected1).toBe(paid1);
    // Σ users equals the pool's own increment.
    expect(pool?.totalUnstakedFeesCollected1).toBe(
      createMockPool().totalUnstakedFeesCollected1 + paid1,
    );
  });

  it("moves the owner on transfer and deletes the position on burn", async () => {
    await mintPosition(7n);
    const block = nextBlock();
    const t = tx(888);
    await run([
      nfpmEvent("Transfer", 1, block, t, {
        from: user,
        to: user2,
        tokenId: 7n,
      }),
    ]);
    const id = NonFungiblePositionId(chainId, AERO_NFPM_ADDRESS, 7n);
    expect((await indexer.NonFungiblePosition.get(id))?.owner).toBe(user2);
    expect(
      (
        await indexer.UserStatsPerPool.get(
          UserStatsPerPoolId(chainId, user2, poolAddress),
        )
      )?.totalLiquidityAddedToken0,
    ).toBeGreaterThan(0n);

    const block2 = nextBlock();
    await run([
      nfpmEvent("Transfer", 1, block2, tx(889), {
        from: user2,
        to: ZERO_ADDRESS,
        tokenId: 7n,
      }),
    ]);
    expect(await indexer.NonFungiblePosition.get(id)).toBeUndefined();
  });
});
