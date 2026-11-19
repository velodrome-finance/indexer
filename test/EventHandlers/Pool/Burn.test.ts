import { createTestIndexer } from "envio";
import {
  TxPoolTransferRegistryId,
  UserStatsPerPoolId,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import { registerPool } from "../../registerDynamicContracts";
import { setupCommon } from "./common";

describe("Pool Burn Event", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  let commonData: ReturnType<typeof setupCommon>;

  beforeEach(async () => {
    indexer = createTestIndexer();
    commonData = setupCommon();
    await registerPool(
      indexer,
      10,
      commonData.mockLiquidityPoolData.poolAddress,
    );

    // Set up test indexer with common data
    indexer.Pool.set(commonData.mockLiquidityPoolData);
    indexer.Token.set(commonData.mockToken0Data);
    indexer.Token.set(commonData.mockToken1Data);
  });

  it("should process burn event and update liquidity pool aggregator", async () => {
    const chainId = 10 as const;

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "Pool",
              event: "Burn",
              srcAddress: commonData.mockLiquidityPoolData
                .poolAddress as `0x${string}`,
              logIndex: 1,
              block: {
                timestamp: 1000000,
                number: 123456,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              params: {
                sender: toChecksumAddress(
                  "0x2222222222222222222222222222222222222222",
                ),
                to: toChecksumAddress(
                  "0x3333333333333333333333333333333333333333",
                ),
                amount0: 500n * 10n ** 18n,
                amount1: 1000n * 10n ** 18n,
              },
            },
          ],
        },
      },
    });

    // Verify that the liquidity pool aggregator was updated
    const rawAggregator = await indexer.Pool.get(
      commonData.mockLiquidityPoolData.id,
    );
    const { rehydrateTimestamps } = await import(
      "../../../src/EntityTimestamps"
    );
    const updatedAggregator = rawAggregator
      ? rehydrateTimestamps("Pool", rawAggregator)
      : undefined;
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.lastUpdatedTimestamp).toEqual(
      new Date(1000000 * 1000),
    );

    // Verify that reserves are NOT updated by Burn events
    // Only Sync events update reserves (they contain absolute values)
    expect(updatedAggregator?.reserve0).toBe(
      commonData.mockLiquidityPoolData.reserve0,
    );
    expect(updatedAggregator?.reserve1).toBe(
      commonData.mockLiquidityPoolData.reserve1,
    );
  });

  // The log layout of a real router removal on Metal (tx 0x4c6ea1db…e322,
  // block 36976697, pool 0xfffb9b75…f36): the router pulls the holder's LP
  // straight into the pool (transferFrom holder -> pool), the pool burns its
  // own balance (Transfer pool -> 0), pays out, Syncs and emits
  // Burn(sender = router, to = holder). The removal belongs to the holder, not
  // to the pool (upstream #911).
  describe.each([
    ["legacy", "VELODROME"],
    ["Aero", "AERO"],
  ] as const)("router removal on a %s V2 pool", (_label, deployment) => {
    const chainId = 10 as const;
    const txHash =
      "0x4c6ea1db59c87ebd2f67fb938d4bf4ad1f526bc7b7ea93d20c08fc67a253e322";
    const block = {
      timestamp: 1_700_000_000,
      number: 36976697,
      hash: "0x9999999999999999999999999999999999999999999999999999999999999999",
    };
    const holder = toChecksumAddress(
      "0xda23e642f9e100cf58581a0189e128d39a5b3997",
    );
    const router = toChecksumAddress(
      "0x3a63171dd9bebf4d07bc782fecc7eb0b890c2a45",
    );
    const lp = 51859612028073801645n;
    const amount0 = 158254563456284470n;
    const amount1 = 17002388268259501818525n;

    /** Simulated logs of one removal; `burnTo` is Burn's `to` (the payee). */
    const removal = (
      pool: string,
      lpSender: string,
      burnTo: string,
      firstLog = 0,
      hash = txHash,
    ) => [
      {
        contract: "Pool" as const,
        event: "Transfer" as const,
        srcAddress: pool as `0x${string}`,
        logIndex: firstLog,
        block,
        transaction: { hash },
        params: { from: lpSender, to: pool, value: lp },
      },
      {
        contract: "Pool" as const,
        event: "Transfer" as const,
        srcAddress: pool as `0x${string}`,
        logIndex: firstLog + 1,
        block,
        transaction: { hash },
        params: { from: pool, to: ZERO_ADDRESS, value: lp },
      },
      {
        contract: "Pool" as const,
        event: "Burn" as const,
        srcAddress: pool as `0x${string}`,
        logIndex: firstLog + 5,
        block,
        transaction: { hash },
        params: { sender: router, to: burnTo, amount0, amount1 },
      },
    ];

    beforeEach(() => {
      indexer.Pool.set({
        ...commonData.mockLiquidityPoolData,
        deployment,
        totalLPTokenSupply: 10n * lp,
      });
      indexer.UserStatsPerPool.set({
        ...commonData.createMockUserStatsPerPool({
          userAddress: holder,
          poolAddress: commonData.mockLiquidityPoolData.poolAddress,
          chainId,
        }),
        lpBalance: lp,
      });
    });

    const removed = async (user: string) => {
      const row = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(
          chainId,
          user,
          commonData.mockLiquidityPoolData.poolAddress,
        ),
      );
      return [
        row?.totalLiquidityRemovedToken0 ?? 0n,
        row?.totalLiquidityRemovedToken1 ?? 0n,
      ];
    };

    it("credits the LP holder that sent the LP into the pool, not the pool", async () => {
      const pool = commonData.mockLiquidityPoolData.poolAddress;
      await indexer.process({
        chains: { [chainId]: { simulate: removal(pool, holder, holder) } },
      });

      expect(await removed(holder)).toEqual([amount0, amount1]);
      expect(await removed(pool)).toEqual([0n, 0n]);
      expect(await removed(router)).toEqual([0n, 0n]);
    });

    it("credits the LP sender even when the tokens are paid to someone else", async () => {
      const pool = commonData.mockLiquidityPoolData.poolAddress;
      const payee = toChecksumAddress(
        "0x5555555555555555555555555555555555555555",
      );
      await indexer.process({
        chains: { [chainId]: { simulate: removal(pool, holder, payee) } },
      });

      expect(await removed(holder)).toEqual([amount0, amount1]);
      expect(await removed(payee)).toEqual([0n, 0n]);
    });

    it("falls back to Burn's `to` when no LP entered the pool in the tx", async () => {
      // LP sent to the pool in an earlier tx, burned by a later call: the
      // pool's own burn Transfer is the only LP log of the burning tx.
      const pool = commonData.mockLiquidityPoolData.poolAddress;
      const [, burnTransfer, burn] = removal(pool, holder, holder);
      await indexer.process({
        chains: { [chainId]: { simulate: [burnTransfer, burn] } },
      });

      expect(await removed(holder)).toEqual([amount0, amount1]);
      expect(await removed(pool)).toEqual([0n, 0n]);
    });

    it("two removals in one tx each credit their own LP sender and leave no staging rows", async () => {
      const pool = commonData.mockLiquidityPoolData.poolAddress;
      const second = toChecksumAddress(
        "0x6666666666666666666666666666666666666666",
      );
      indexer.UserStatsPerPool.set({
        ...commonData.createMockUserStatsPerPool({
          userAddress: second,
          poolAddress: pool,
          chainId,
        }),
        lpBalance: lp,
      });
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              ...removal(pool, holder, holder, 0),
              ...removal(pool, second, second, 10),
            ],
          },
        },
      });

      expect(await removed(holder)).toEqual([amount0, amount1]);
      expect(await removed(second)).toEqual([amount0, amount1]);
      expect(await removed(pool)).toEqual([0n, 0n]);
      expect(
        await indexer.TxPoolTransferRegistry.get(
          TxPoolTransferRegistryId(chainId, txHash, pool),
        ),
      ).toBeUndefined();
    });
  });

  describe("when pool data cannot be loaded", () => {
    it("should return early without processing", async () => {
      // Note: we intentionally don't seed the Pool. `registerPool` had to
      // replay `PoolFactory.PoolCreated` to put the address on the chain, and
      // that handler always writes a Pool row — so the row here is the factory
      // default, pointing at token ids that were never created. `loadPoolData`
      // returns null on that missing-token branch, which is the early return
      // under test.
      const freshIndexer = createTestIndexer();
      await registerPool(
        freshIndexer,
        10,
        commonData.mockLiquidityPoolData.poolAddress,
      );
      freshIndexer.Token.set(commonData.mockToken0Data);
      freshIndexer.Token.set(commonData.mockToken1Data);

      const chainId = 10 as const;

      await freshIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Burn",
                srcAddress: commonData.mockLiquidityPoolData
                  .poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  sender: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  to: toChecksumAddress(
                    "0x2222222222222222222222222222222222222222",
                  ),
                  amount0: 500n * 10n ** 18n,
                  amount1: 1000n * 10n ** 18n,
                },
              },
            ],
          },
        },
      });

      // The burn never reached the pool: the factory-created row is untouched.
      const pool = await freshIndexer.Pool.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(pool).toBeDefined();
      expect(pool?.reserve0).toBe(0n);
      expect(pool?.reserve1).toBe(0n);

      // User stats will NOT be created when pool doesn't exist (early return)
      // and no transfer match is found
      const userStats = await freshIndexer.UserStatsPerPool.get(
        `0x1111111111111111111111111111111111111111_${commonData.mockLiquidityPoolData.poolAddress}_10`,
      );
      expect(userStats).toBeUndefined();
    });
  });
});
