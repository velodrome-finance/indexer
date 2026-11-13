import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  POOL_DEPLOYMENT,
  PoolFactoryDefaultFeeId,
  PoolId,
  TEN_TO_THE_18_BI,
  TokenId,
  UserStatsPerPoolId,
  V2SwapFeesInTxId,
  toChecksumAddress,
} from "../../../src/Constants";
import { deriveV2FeeRate } from "../../../src/EventHandlers/Pool/PoolSwapLogic";
import * as PriceOracle from "../../../src/PriceOracle";
import { registerPool } from "../../registerDynamicContracts";
import { setupCommon } from "./common";
import "../../eventHandlersRegistration";

// V2 fee USD comes from the amounts the pool's Fees events report, handed to
// the Swap that follows them in the same tx (V2SwapFeesInTx), and the swap's
// effective rate is written to currentFee. The stored rate alone was wrong for
// pools whose fee a module the indexer did not follow had changed, e.g. Metal
// stable pool 0x173c…7cd2: stored 5 bps, charges 200 bps.
describe("V2 swap fees from Fees events", () => {
  const { mockToken0Data, mockToken1Data, createMockPool } = setupCommon();
  const chainId = 10 as const;
  const pool = toChecksumAddress("0x3333333333333333333333333333333333333333");
  const trader = toChecksumAddress(
    "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  );
  const txHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const block = {
    timestamp: 1_000_000,
    number: 100,
    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  };

  // Stored at the 5 bps stable default; the pool really charges 200 bps.
  const storedPool = createMockPool({
    poolAddress: pool,
    id: PoolId(chainId, pool),
    isStable: true,
    baseFee: 500n,
    currentFee: 500n,
    totalFeesGenerated0: 0n,
    totalFeesGenerated1: 0n,
    totalFeesGeneratedUSD: 0n,
  });

  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(async () => {
    indexer = createTestIndexer();
    await registerPool(indexer, chainId, pool);
    vi.spyOn(PriceOracle, "refreshTokenPrice").mockImplementation(
      async (...args) => args[0],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fees(amount0: bigint, amount1: bigint, logIndex: number) {
    return {
      contract: "Pool" as const,
      event: "Fees" as const,
      srcAddress: pool,
      logIndex,
      block,
      transaction: { hash: txHash, from: trader },
      params: { sender: trader, amount0, amount1 },
    };
  }

  function swap(
    amount0In: bigint,
    amount1Out: bigint,
    logIndex: number,
    amount1In = 0n,
    amount0Out = 0n,
  ) {
    return {
      contract: "Pool" as const,
      event: "Swap" as const,
      srcAddress: pool,
      logIndex,
      block,
      transaction: { hash: txHash, from: trader },
      params: {
        sender: trader,
        to: trader,
        amount0In,
        amount1In,
        amount0Out,
        amount1Out,
      },
    };
  }

  async function run(
    items: unknown[],
    token1: Token = mockToken1Data as Token,
  ): Promise<void> {
    indexer.Pool.set(storedPool);
    indexer.Token.set(mockToken0Data as Token);
    indexer.Token.set(token1);
    await indexer.process({
      // biome-ignore lint/suspicious/noExplicitAny: mixed Fees / Swap items
      chains: { [chainId]: { simulate: items as any } },
    });
  }

  it("values the fee from the Fees amounts and derives the 200 bps rate", async () => {
    // 100 token0 ($1, 18 decimals) in; the pool takes 2% = 2 token0.
    const amountIn = 100n * TEN_TO_THE_18_BI;
    const feeIn = (amountIn * 200n) / 10_000n;
    await run([fees(feeIn, 0n, 1), swap(amountIn, 97n * 10n ** 6n, 3)]);

    const p = await indexer.Pool.get(PoolId(chainId, pool));
    expect(p?.totalFeesGeneratedUSD).toBe(2n * TEN_TO_THE_18_BI);
    expect(p?.currentFee).toBe(20_000n); // 200 bps in FEE_SCALE
    expect(p?.baseFee).toBe(500n); // configuration is left alone
    const user = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, trader, pool),
    );
    expect(user?.totalFeesContributedUSD).toBe(2n * TEN_TO_THE_18_BI);
    // The hand-over row is consumed.
    expect(
      await indexer.V2SwapFeesInTx.get(V2SwapFeesInTxId(chainId, txHash, pool)),
    ).toBeUndefined();
  });

  it("a swap with no Fees event paid no fee", async () => {
    await run([swap(100n * TEN_TO_THE_18_BI, 99n * 10n ** 6n, 2)]);
    const p = await indexer.Pool.get(PoolId(chainId, pool));
    expect(p?.totalFeesGeneratedUSD).toBe(0n);
    expect(p?.currentFee).toBe(0n);
  });

  it("two swaps through the pool in one tx each get their own fee", async () => {
    const a = 100n * TEN_TO_THE_18_BI;
    const b = 50n * 10n ** 6n; // second swap: token1 in
    await run([
      fees(a / 100n, 0n, 1),
      swap(a, 98n * 10n ** 6n, 3),
      fees(0n, b / 100n, 4),
      swap(0n, 0n, 6, b, 49n * TEN_TO_THE_18_BI),
    ]);
    const p = await indexer.Pool.get(PoolId(chainId, pool));
    // $1 + $0.50
    expect(p?.totalFeesGeneratedUSD).toBe((3n * TEN_TO_THE_18_BI) / 2n);
    expect(p?.currentFee).toBe(10_000n);
  });

  it("untrusted input leg: fee scaled from the trusted volume, not the stored rate", async () => {
    // token1 is untrusted and is the input; volume falls back to the trusted
    // token0 leg ($100 out), and the fee is that × feeIn / amountIn = 2%.
    const untrusted: Token = {
      ...(mockToken1Data as Token),
      isWhitelisted: false,
      priceTrustOutcome: "UNTRUSTED",
      priceTrustReason: "NON_WL",
    };
    const amountIn = 100n * 10n ** 6n;
    await run(
      [
        fees(0n, (amountIn * 200n) / 10_000n, 1),
        swap(0n, 0n, 3, amountIn, 100n * TEN_TO_THE_18_BI),
      ],
      untrusted,
    );
    const p = await indexer.Pool.get(PoolId(chainId, pool));
    expect(p?.totalFeesGeneratedUSD).toBe(2n * TEN_TO_THE_18_BI);
    expect(p?.currentFee).toBe(20_000n);
  });

  it("deriveV2FeeRate rounds to the basis point and ignores dust", () => {
    // The pool floors amountIn × fee / 10000.
    expect(deriveV2FeeRate(19_999_999n, 1_000_000_000n)).toBe(20_000n);
    expect(deriveV2FeeRate(49_999n, 100_000_000n)).toBe(500n);
    expect(deriveV2FeeRate(0n, 100_000_000n)).toBe(0n);
    expect(deriveV2FeeRate(1n, 9_999_999n)).toBeUndefined();
  });
});

describe("V2 factory default fee (SetDefaultFee)", () => {
  const { mockToken0Data, mockToken1Data, createMockPool } = setupCommon();
  const block = {
    timestamp: 1_790_000_000,
    number: 30_000_000,
    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  };

  it("leaf PoolFactory: stores the per-type default, used by a module's 0 reset", async () => {
    const chainId = 1750 as const; // Metal
    const factory = toChecksumAddress(
      "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
    );
    const leafModule = toChecksumAddress(
      "0x81c5d01AE474040A59d0092a6973F4621E06B362",
    );
    const metalStable = toChecksumAddress(
      "0x173c249bd99d8c04ebf65f19039dbc1e94787cd2",
    );
    const idx = createTestIndexer();
    idx.Pool.set(
      createMockPool({
        chainId,
        poolAddress: metalStable,
        id: PoolId(chainId, metalStable),
        isStable: true,
        factoryAddress: factory,
        baseFee: 500n,
        currentFee: 500n,
      }),
    );
    await idx.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "PoolFactory",
              event: "SetDefaultFee",
              srcAddress: factory,
              logIndex: 1,
              block,
              params: { stable: true, fee: 7n },
            },
            // Metal's module set this pool to 200 bps on-chain.
            {
              contract: "V2CustomFeeModule",
              event: "SetCustomFee",
              srcAddress: leafModule,
              logIndex: 2,
              block,
              params: { pool: metalStable, fee: 200n },
            },
          ],
        },
      },
    });
    const row = await idx.PoolFactoryDefaultFee.get(
      PoolFactoryDefaultFeeId(chainId, factory, true),
    );
    expect(row?.fee).toBe(700n);
    let p = await idx.Pool.get(PoolId(chainId, metalStable));
    expect(p?.baseFee).toBe(20_000n);
    expect(p?.currentFee).toBe(20_000n);

    // Back to the factory default: the stored SetDefaultFee, not 5 bps.
    await idx.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "V2CustomFeeModule",
              event: "SetCustomFee",
              srcAddress: leafModule,
              logIndex: 1,
              block: { ...block, number: block.number + 1 },
              params: { pool: metalStable, fee: 0n },
            },
          ],
        },
      },
    });
    p = await idx.Pool.get(PoolId(chainId, metalStable));
    expect(p?.baseFee).toBe(700n);
  });

  it("Aero factory: a pool created after SetDefaultFee starts at it", async () => {
    const chainId = 57073 as const;
    const volatileFactory = toChecksumAddress(
      "0x8E6a9FCd1d638CC760Ffba397605Fe3355dE76D2",
    );
    const token0 = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const token1 = toChecksumAddress(
      "0x2222222222222222222222222222222222222222",
    );
    const pool = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );
    const idx = createTestIndexer();
    for (const [t, data] of [
      [token0, mockToken0Data],
      [token1, mockToken1Data],
    ] as const) {
      idx.Token.set({
        ...(data as Token),
        id: TokenId(chainId, t),
        address: t,
        chainId,
      });
    }
    await idx.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "AeroVolatilePoolFactory",
              event: "SetDefaultFee",
              srcAddress: volatileFactory,
              logIndex: 1,
              block,
              params: { defaultFee: 25n },
            },
            {
              contract: "AeroVolatilePoolFactory",
              event: "PoolCreated",
              srcAddress: volatileFactory,
              logIndex: 2,
              block,
              params: { token0, token1, pool, poolCount: 1n },
            },
          ],
        },
      },
    });
    const p = await idx.Pool.get(PoolId(chainId, pool));
    expect(p?.deployment).toBe(POOL_DEPLOYMENT.AERO);
    expect(p?.baseFee).toBe(2500n);
    expect(p?.currentFee).toBe(2500n);
  });
});
