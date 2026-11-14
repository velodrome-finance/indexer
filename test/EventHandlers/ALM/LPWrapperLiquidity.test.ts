import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  ALMLPWrapperId,
  NonFungiblePositionId,
  TokenId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  registerALMLPWrapperV2,
  registerCLPools,
} from "../../registerDynamicContracts";
import { setupCommon } from "../Pool/common";

// ALM_LP_Wrapper.liquidity must equal the strategy position's own liquidity.
// Real Soneium events of wrapper 0xcd975e6a…7925 (pool 0x5441c4c5…667b,
// WETH/USDC.e, legacy NFPM 0x991d…4702, strategy position tokenId 83619,
// range [-203000, -195000]):
//  - deposit tx 0xa4a08ed3…bea8 (block 27020585): the Core unstakes the NFT,
//    NFPM.IncreaseLiquidity(83619, +21218890067291) at log 27, restakes it,
//    then the wrapper's Deposit at log 37. The gauge logs the position at
//    84025060359009 before and 105243950426300 after.
//  - withdraw tx 0x89f03aea…5f67 (block 29805445):
//    NFPM.DecreaseLiquidity(83619, −84789518007) at log 8, Withdraw at log 15.
//    The Withdraw amounts include the position's fees, so liquidity
//    re-derived from them overstates the decrease.
describe("ALM_LP_Wrapper.liquidity follows the strategy position", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    mockALMLPWrapperData,
    createMockPool,
  } = setupCommon();
  const chainId = 1868 as const;
  const pool = toChecksumAddress("0x5441c4c5cc00d33bd9409f742d511ee01db1667b");
  const wrapper = toChecksumAddress(
    "0xcd975e6a5f55137755487f0918b8ca74acce7925",
  );
  const nfpm = toChecksumAddress("0x991d5546C4B442B4c5fdc4c8B8b8d131DEB24702");
  const core = toChecksumAddress("0x0000000ce42d4981513060ab7e50b9e5e2d19af1");
  const tokenId = 83619n;
  const tickLower = -203000n;
  const tickUpper = -195000n;

  let indexer: ReturnType<typeof createTestIndexer>;

  /** Seeds pool, tokens, wrapper and position at the given liquidity / price. */
  async function seed(liquidity: bigint, sqrtPriceX96: bigint, tick: bigint) {
    indexer = createTestIndexer();
    await registerCLPools(indexer, chainId, [pool]);
    await registerALMLPWrapperV2(indexer, chainId, wrapper, { pool });
    const weth = { ...mockToken0Data, decimals: 18n };
    const usdc = { ...mockToken1Data, decimals: 6n };
    for (const t of [weth, usdc]) {
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
        nfpmAddress: nfpm,
        sqrtPriceX96,
        tick,
        token0_id: TokenId(chainId, weth.address),
        token1_id: TokenId(chainId, usdc.address),
      }),
    );
    indexer.ALM_LP_Wrapper.set({
      ...mockALMLPWrapperData,
      id: ALMLPWrapperId(chainId, wrapper),
      chainId,
      pool,
      tokenId,
      tickLower,
      tickUpper,
      liquidity,
    });
    indexer.NonFungiblePosition.set({
      id: NonFungiblePositionId(chainId, nfpm, tokenId),
      chainId,
      tokenId,
      nfpmAddress: nfpm,
      owner: core,
      pool,
      tickLower,
      tickUpper,
      token0: weth.address,
      token1: usdc.address,
      liquidity,
      mintTransactionHash: `0x${"0".repeat(64)}`,
      mintLogIndex: 0,
      lastUpdatedTimestamp: new Date(0),
      lastSnapshotTimestamp: undefined,
      isStakedInGauge: false,
    });
  }

  const wrapperLiquidity = async () =>
    (await indexer.ALM_LP_Wrapper.get(ALMLPWrapperId(chainId, wrapper)))
      ?.liquidity;

  it("deposit: the position's liquidity after its IncreaseLiquidity", async () => {
    await seed(84025060359009n, 3780079799256136969013528n, -199017n);
    const block = {
      number: 27020585,
      timestamp: 1_760_000_000,
      hash: `0x${"1".repeat(64)}`,
    };
    const transaction = {
      hash: "0xa4a08ed3df0897e72a812f2b7f5fd19e0cdb012a520de98634d9a998212dbea8",
    };
    const depositor = toChecksumAddress(
      "0xf6b9e9970258005755879acc67644274538913d5",
    );
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "NFPM",
              event: "IncreaseLiquidity",
              srcAddress: nfpm,
              logIndex: 27,
              block,
              transaction,
              params: {
                tokenId,
                liquidity: 21218890067291n,
                amount0: 80918665110174929n,
                amount1: 182809189n,
              },
            },
            {
              contract: "ALMLPWrapperV2",
              event: "Deposit",
              srcAddress: wrapper,
              logIndex: 37,
              block,
              transaction,
              params: {
                sender: depositor,
                recipient: depositor,
                pool,
                amount0: 80918665110174929n,
                amount1: 182809189n,
                lpAmount: 35806356392013n,
                totalSupply: 177596584228337n,
              },
            },
          ],
        },
      },
    });

    expect(await wrapperLiquidity()).toBe(105243950426300n);
  });

  it("withdraw: the position's liquidity after its DecreaseLiquidity, fees in the amounts notwithstanding", async () => {
    // The position held 25871233405391 on chain after this (last) withdraw.
    await seed(25956022923398n, 3888180837429040613306041n, -198453n);
    const block = {
      number: 29805445,
      timestamp: 1_765_000_000,
      hash: `0x${"2".repeat(64)}`,
    };
    const transaction = {
      hash: "0x89f03aeac1a89738b3fbc08fa7785d51987110288f54c551bacabe487ada5f67",
    };
    const holder = toChecksumAddress(
      "0x8c7df6054c2e0eb3ab35e1064500ec1812930200",
    );
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "NFPM",
              event: "DecreaseLiquidity",
              srcAddress: nfpm,
              logIndex: 8,
              block,
              transaction,
              params: {
                tokenId,
                liquidity: 84789518007n,
                amount0: 273937749602905n,
                amount1: 846184n,
              },
            },
            {
              contract: "ALMLPWrapperV2",
              event: "Withdraw",
              srcAddress: wrapper,
              logIndex: 15,
              block,
              transaction,
              params: {
                sender: holder,
                recipient: holder,
                pool,
                amount0: 289249632764830n,
                amount1: 884781n,
                lpAmount: 143080231362n,
                totalSupply: 43657071631757n,
              },
            },
          ],
        },
      },
    });

    expect(await wrapperLiquidity()).toBe(25871233405391n);
  });
});
