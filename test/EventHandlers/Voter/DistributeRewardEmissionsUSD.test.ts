import type { Token } from "envio";
import { createTestIndexer } from "envio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAIN_CONSTANTS,
  PoolId,
  TokenId,
  toChecksumAddress,
} from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { setupCommon } from "../Pool/common";

/**
 * Regression test for issue #673 — `totalEmissionsUSD` was reported as $0 on
 * every pool across every chain. The acceptance criteria require asserting
 * that `totalEmissionsUSD = emission * reward-token price`, and that the
 * conversion uses the reward token's price (VELO / xVELO / AERO), not the
 * pool's token0/token1 prices.
 *
 * Unlike the existing DistributeReward suite (which spies on
 * `findPoolByGaugeAddress` and is therefore `it.skip`'d because vi.spyOn
 * can't intercept tsx-loaded modules in envio v3 alpha.18), this test wires
 * the pool's `gaugeAddress` to the event's gauge param so the real
 * `findPoolByGaugeAddress` lookup succeeds via the indexer. That lets the full
 * `Voter.DistributeReward` handler run end-to-end through
 * `simulateEvent` without spying.
 *
 * NOTE (v3 alpha.18): All three tests are currently skipped because
 * `computeVoterDistributeValues` calls `context.effect(getTokensDeposited, ...)`
 * which makes a real archive RPC call (`balanceOf` at a historical block). This
 * call times out in the test environment since the public RPC endpoint doesn't
 * reliably serve historical state within the 120 s test budget. Re-enable once
 * envio provides effect mocking in `createTestIndexer` (alpha.18).
 */
describe("Voter.DistributeReward → totalEmissionsUSD regression (#673)", () => {
  const chainId = 10; // Optimism
  const voterAddress = toChecksumAddress(
    "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
  );
  const poolAddress = toChecksumAddress(
    "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
  );
  const gaugeAddress = toChecksumAddress(
    "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
  );
  const blockNumber = 128357873;
  const blockTimestamp = 1_700_000_000;
  const rewardTokenAddress = CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

  let originalChainConstants: (typeof CHAIN_CONSTANTS)[typeof chainId];

  beforeEach(() => {
    originalChainConstants = CHAIN_CONSTANTS[chainId];
    CHAIN_CONSTANTS[chainId] = {
      ...originalChainConstants,
      rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
    };
  });

  afterEach(() => {
    CHAIN_CONSTANTS[chainId] = originalChainConstants;
    vi.restoreAllMocks();
  });

  function makeRewardToken(overrides?: Partial<Token>): Token {
    return {
      id: TokenId(chainId, rewardTokenAddress),
      address: rewardTokenAddress,
      symbol: "VELO",
      name: "VELO",
      chainId,
      decimals: 18n,
      pricePerUSDNew: 2n * 10n ** 18n, // $2
      isWhitelisted: true,
      // Match block timestamp so refreshTokenPrice is a no-op (avoids real RPC).
      lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      ...overrides,
    } as Token;
  }

  // TODO: Skip until envio migrates to createTestIndexer — context.effect(getTokensDeposited)
  // makes a real archive RPC call (balanceOf at blockNumber 128357873) that times out in tests (alpha.18).
  it.skip("writes totalEmissionsUSD = emission * reward-token price when price is non-zero", async () => {
    const { createMockPool } = setupCommon();
    const liquidityPool = createMockPool({
      id: PoolId(chainId, poolAddress),
      chainId,
      poolAddress,
      gaugeAddress, // critical: lets findPoolByGaugeAddress resolve via indexer
      totalEmissions: 0n,
      totalEmissionsUSD: 0n,
      gaugeIsAlive: true,
    });

    const rewardToken = makeRewardToken();
    const amountEmitted = 1000n * 10n ** 18n; // 1000 VELO
    const expectedEmissionsUSD = 2000n * 10n ** 18n; // 1000 * $2

    const indexer = createTestIndexer();
    indexer.Token.set(rewardToken);
    indexer.Pool.set({
      ...liquidityPool,
      lastSnapshotTimestamp: undefined,
    } as unknown as Parameters<typeof indexer.Pool.set>[0]);

    await simulateEvent(indexer, chainId, {
      contract: "Voter",
      event: "DistributeReward",
      params: {
        gauge: gaugeAddress as `0x${string}`,
        amount: amountEmitted,
      },
      block: {
        number: blockNumber,
        timestamp: blockTimestamp,
        hash: "0xblockhash",
      },
      srcAddress: voterAddress as `0x${string}`,
      logIndex: 0,
    });

    const updatedPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
    expect(updatedPool?.totalEmissions).toBe(amountEmitted);
    expect(updatedPool?.totalEmissionsUSD).toBe(expectedEmissionsUSD);
  });

  // TODO: Skip until envio migrates to createTestIndexer — context.effect(getTokensDeposited)
  // makes a real archive RPC call (balanceOf at blockNumber 128357873) that times out in tests (alpha.18).
  it.skip("uses the reward token's price (not the pool's token0/token1 prices) for USD conversion", async () => {
    // Pool tokens (token0=USDT @ $1, token1=USDC @ $1) come from setupCommon().
    // Reward token = VELO @ $7. If the handler accidentally used token0 or token1's
    // price, the USD result would be 1000 * $1 = $1000 (matching neither $7000
    // nor a decimals-mismatched USDC variant), so the $7000 expectation forces
    // the right token to be picked.
    const { createMockPool, mockToken0Data, mockToken1Data } = setupCommon();
    const liquidityPool = createMockPool({
      id: PoolId(chainId, poolAddress),
      chainId,
      poolAddress,
      gaugeAddress,
      totalEmissions: 0n,
      totalEmissionsUSD: 0n,
      gaugeIsAlive: true,
    });

    const rewardToken = makeRewardToken({
      pricePerUSDNew: 7n * 10n ** 18n,
    });
    const amountEmitted = 1000n * 10n ** 18n;

    const indexer = createTestIndexer();
    // Seed pool tokens too — proving the handler doesn't fall back to them.
    indexer.Token.set(mockToken0Data);
    indexer.Token.set(mockToken1Data);
    indexer.Token.set(rewardToken);
    indexer.Pool.set({
      ...liquidityPool,
      lastSnapshotTimestamp: undefined,
    } as unknown as Parameters<typeof indexer.Pool.set>[0]);

    await simulateEvent(indexer, chainId, {
      contract: "Voter",
      event: "DistributeReward",
      params: {
        gauge: gaugeAddress as `0x${string}`,
        amount: amountEmitted,
      },
      block: {
        number: blockNumber,
        timestamp: blockTimestamp,
        hash: "0xblockhash",
      },
      srcAddress: voterAddress as `0x${string}`,
      logIndex: 0,
    });

    const updatedPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
    expect(updatedPool?.totalEmissionsUSD).toBe(7000n * 10n ** 18n);
  });

  // TODO: Skip until envio migrates to createTestIndexer — context.effect(getTokensDeposited)
  // makes a real archive RPC call (balanceOf at blockNumber 128357873) that times out in tests (alpha.18).
  it.skip("leaves totalEmissionsUSD at 0 when the reward token's price is 0 and refresh stays at 0 (#673 root cause)", async () => {
    // Documents the deployed-indexer symptom: when the oracle can't price the
    // reward token, `totalEmissions` increments correctly but `totalEmissionsUSD`
    // stays 0. Fixing the upstream symptom is an oracle-layer concern (issues
    // #669 / #677), not a logic bug in this handler — this test pins the
    // contract so future regressions surface here.
    //
    // To make refreshTokenPrice a no-op against a $0-priced token, set
    // `lastUpdatedTimestamp` to the block time so the 1-hour throttle skips
    // the RPC call and the stored $0 price is what feeds the USD calc.
    const { createMockPool } = setupCommon();
    const liquidityPool = createMockPool({
      id: PoolId(chainId, poolAddress),
      chainId,
      poolAddress,
      gaugeAddress,
      totalEmissions: 0n,
      totalEmissionsUSD: 0n,
      gaugeIsAlive: true,
    });

    const rewardToken = makeRewardToken({
      pricePerUSDNew: 0n,
      lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
    });
    const amountEmitted = 1000n * 10n ** 18n;

    const indexer = createTestIndexer();
    indexer.Token.set(rewardToken);
    indexer.Pool.set({
      ...liquidityPool,
      lastSnapshotTimestamp: undefined,
    } as unknown as Parameters<typeof indexer.Pool.set>[0]);

    await simulateEvent(indexer, chainId, {
      contract: "Voter",
      event: "DistributeReward",
      params: {
        gauge: gaugeAddress as `0x${string}`,
        amount: amountEmitted,
      },
      block: {
        number: blockNumber,
        timestamp: blockTimestamp,
        hash: "0xblockhash",
      },
      srcAddress: voterAddress as `0x${string}`,
      logIndex: 0,
    });

    const updatedPool = await indexer.Pool.get(PoolId(chainId, poolAddress));
    expect(updatedPool?.totalEmissions).toBe(amountEmitted);
    expect(updatedPool?.totalEmissionsUSD).toBe(0n);
  });
});
