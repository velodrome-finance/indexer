import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  POOL_DEPLOYMENT,
  UserStatsPerPoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import "../../eventHandlersRegistration";
import { registerPool } from "../../registerDynamicContracts";
import { setupCommon } from "./common";

// Aero V2 pools emit Claim(caller, account, recipient, amount0, amount1): the
// fees belong to `account`, whoever triggered the claim.
describe("Pool ClaimWithAccount (Aero V2)", () => {
  const { mockToken0Data, mockToken1Data, createMockPool } = setupCommon();
  const chainId = 10 as const;
  const poolAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const operator = toChecksumAddress(
    "0x1000000000000000000000000000000000000001",
  );
  const account = toChecksumAddress(
    "0x2000000000000000000000000000000000000002",
  );
  const recipient = toChecksumAddress(
    "0x3000000000000000000000000000000000000003",
  );
  const block = {
    timestamp: 1_790_000_000,
    number: 158_500_000,
    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  };

  it("credits the account's unstaked fees and the pool's totals", async () => {
    const indexer = createTestIndexer();
    await registerPool(indexer, chainId, poolAddress);
    const pool = createMockPool({
      poolAddress,
      deployment: POOL_DEPLOYMENT.AERO,
      totalUnstakedFeesCollected0: 0n,
      totalUnstakedFeesCollected1: 0n,
    });
    indexer.Pool.set(pool);
    indexer.Token.set(mockToken0Data as Token);
    indexer.Token.set(mockToken1Data as Token);

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "Pool",
              event: "ClaimWithAccount",
              srcAddress: poolAddress,
              logIndex: 1,
              block,
              params: {
                caller: operator,
                account,
                recipient,
                amount0: 1000n,
                amount1: 2000n,
              },
            },
          ],
        },
      },
    });

    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, account, poolAddress),
    );
    expect(stats?.totalUnstakedFeesCollected0).toBe(1000n);
    expect(stats?.totalUnstakedFeesCollected1).toBe(2000n);
    for (const other of [operator, recipient]) {
      expect(
        await indexer.UserStatsPerPool.get(
          UserStatsPerPoolId(chainId, other, poolAddress),
        ),
      ).toBeUndefined();
    }
    const updated = await indexer.Pool.get(pool.id);
    expect(updated?.totalUnstakedFeesCollected0).toBe(1000n);
    expect(updated?.totalUnstakedFeesCollected1).toBe(2000n);
  });
});
