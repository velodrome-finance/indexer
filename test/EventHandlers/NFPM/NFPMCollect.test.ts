import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  NonFungiblePositionId,
  POOL_DEPLOYMENT,
  PoolId,
  TokenId,
  UserStatsPerPoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import { registerCLPools } from "../../registerDynamicContracts";
import { setupCommon } from "../Pool/common";

// Legacy NFPM positions: CLPool.Collect's `owner` is the NFPM contract, so the
// fees must reach the position's owner through the NFPM's own Collect, which
// carries the tokenId. Log layout of a real fee collect on Metal (tx
// 0x307e49c8…912f, block 20005764, pool 0xd53f254c…315a, tokenId 1980):
//   3 CLPool.Collect(owner = NFPM, recipient = holder, -8, -7, 2638, 221)
//   4 NFPM.MetadataUpdate(1980)
//   5 NFPM.Collect(1980, holder, 2638, 221)
describe("legacy NFPM Collect", () => {
  const { mockToken0Data, mockToken1Data, createMockPool } = setupCommon();
  const chainId = 1750 as const; // Metal
  const nfpm = toChecksumAddress("0x991d5546C4B442B4c5fdc4c8B8b8d131DEB24702");
  const pool = toChecksumAddress("0xd53f254c8a0b871c6a260cc290144f579035315a");
  const holder = toChecksumAddress(
    "0x85593464c9dd38ec4625ef44e60cd6e8045aa067",
  );
  const tokenId = 1980n;
  const tickLower = -8n;
  const tickUpper = -7n;
  const fee0 = 2638n;
  const fee1 = 221n;
  const block = {
    number: 20005764,
    timestamp: 1_745_000_000,
    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  };
  const transaction = {
    hash: "0x307e49c8fea6f7ac1cdc0c94d94f8a41c941e8ee440d87301d94fef8d900912f",
  };

  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(async () => {
    indexer = createTestIndexer();
    await registerCLPools(indexer, chainId, [pool]);
    for (const t of [mockToken0Data, mockToken1Data]) {
      indexer.Token.set({
        ...t,
        id: TokenId(chainId, t.address),
        chainId,
      } as Token);
    }
    indexer.Pool.set(
      createMockPool({
        chainId,
        poolAddress: pool,
        isCL: true,
        deployment: POOL_DEPLOYMENT.VELODROME,
        nfpmAddress: nfpm,
        token0_id: TokenId(chainId, mockToken0Data.address),
        token1_id: TokenId(chainId, mockToken1Data.address),
      }),
    );
  });

  const seedPosition = (owner: string) =>
    indexer.NonFungiblePosition.set({
      id: NonFungiblePositionId(chainId, nfpm, tokenId),
      chainId,
      tokenId,
      nfpmAddress: nfpm,
      owner,
      pool,
      tickLower,
      tickUpper,
      token0: mockToken0Data.address,
      token1: mockToken1Data.address,
      liquidity: 1_000_000n,
      mintTransactionHash: transaction.hash,
      mintLogIndex: 0,
      lastUpdatedTimestamp: new Date(0),
      lastSnapshotTimestamp: undefined,
      isStakedInGauge: false,
    });

  const collectLogs = () => [
    {
      contract: "CLPool" as const,
      event: "Collect" as const,
      srcAddress: pool as `0x${string}`,
      logIndex: 3,
      block,
      transaction,
      params: {
        owner: nfpm,
        recipient: holder,
        tickLower,
        tickUpper,
        amount0: fee0,
        amount1: fee1,
      },
    },
    {
      contract: "NFPM" as const,
      event: "Collect" as const,
      srcAddress: nfpm as `0x${string}`,
      logIndex: 5,
      block,
      transaction,
      params: { tokenId, recipient: holder, amount0: fee0, amount1: fee1 },
    },
  ];

  const feesOf = async (user: string) => {
    const row = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, user, pool),
    );
    return [
      row?.totalUnstakedFeesCollected0 ?? 0n,
      row?.totalUnstakedFeesCollected1 ?? 0n,
    ];
  };

  it("credits the fees to the position owner, not the NFPM contract", async () => {
    seedPosition(holder);
    await indexer.process({
      chains: { [chainId]: { simulate: collectLogs() } },
    });

    expect(await feesOf(holder)).toEqual([fee0, fee1]);
    expect(await feesOf(nfpm)).toEqual([0n, 0n]);
    // Pool-level totals still come from CLPool.Collect, unchanged.
    const p = await indexer.Pool.get(PoolId(chainId, pool));
    expect(p?.totalUnstakedFeesCollected0).toBe(
      createMockPool().totalUnstakedFeesCollected0 + fee0,
    );
    expect(p?.totalUnstakedFeesCollected1).toBe(
      createMockPool().totalUnstakedFeesCollected1 + fee1,
    );
  });

  it("credits the position owner, not the payee, when the fees are sent elsewhere", async () => {
    const owner = toChecksumAddress(
      "0x7777777777777777777777777777777777777777",
    );
    seedPosition(owner);
    await indexer.process({
      chains: { [chainId]: { simulate: collectLogs() } },
    });

    expect(await feesOf(owner)).toEqual([fee0, fee1]);
    expect(await feesOf(holder)).toEqual([0n, 0n]);
  });

  it("credits only fees when the collect also pays out burned principal", async () => {
    seedPosition(holder);
    const principal0 = 343114448n;
    const principal1 = 3905697494457n;
    const [poolCollect, nfpmCollect] = collectLogs();
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLPool" as const,
              event: "Burn" as const,
              srcAddress: pool as `0x${string}`,
              logIndex: 0,
              block,
              transaction,
              params: {
                owner: nfpm,
                tickLower,
                tickUpper,
                amount: 1_000_000n,
                amount0: principal0,
                amount1: principal1,
              },
            },
            {
              ...poolCollect,
              params: {
                ...poolCollect.params,
                amount0: principal0 + fee0,
                amount1: principal1 + fee1,
              },
            },
            {
              ...nfpmCollect,
              params: {
                ...nfpmCollect.params,
                amount0: principal0 + fee0,
                amount1: principal1 + fee1,
              },
            },
          ],
        },
      },
    });

    expect(await feesOf(holder)).toEqual([fee0, fee1]);
    expect(await feesOf(nfpm)).toEqual([0n, 0n]);
  });

  it("falls back to the NFPM contract when the position is unknown, so user sums still match the pool", async () => {
    await indexer.process({
      chains: { [chainId]: { simulate: collectLogs() } },
    });

    expect(await feesOf(nfpm)).toEqual([fee0, fee1]);
  });
});
