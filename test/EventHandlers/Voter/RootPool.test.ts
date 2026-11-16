import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import { toChecksumAddress } from "../../../src/Constants";
import {
  RootPoolId,
  RootPoolVoteId,
  SUPERCHAIN_LEAF_CHAIN_IDS,
  deriveV2RootPoolLeafChain,
  predictV2RootPoolAddress,
} from "../../../src/EventHandlers/Voter/RootPoolLogic";

const OP = 10 as const;
const ROOT_CL_FACTORY = toChecksumAddress(
  "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
);
const ROOT_V2_FACTORY = toChecksumAddress(
  "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
);
const VOTER = toChecksumAddress("0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C");
const block = (number: number, timestamp: number) => ({
  number,
  timestamp,
  hash: `0x${number.toString(16)}`,
});

describe("V2 root pool address derivation", () => {
  it("reproduces the leaf LpHelper's root_lp_address (Metal WETH/oUSDT vAMM)", () => {
    // getRootPoolAddress cache: {chainId 1750, token0 oUSDT, token1 WETH, type -1}
    expect(
      predictV2RootPoolAddress(
        ROOT_V2_FACTORY,
        1750,
        "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
        "0x4200000000000000000000000000000000000006",
        false,
      ),
    ).toBe("0xE96a48891686A15f7b55De3fCE9c97f412744A66");
  });

  it("finds the leaf chain of a real V2 root pool (Optimism block 127,697,794)", () => {
    expect(
      deriveV2RootPoolLeafChain(
        ROOT_V2_FACTORY,
        "0x5b0DF9c40e3b571974167E642c15564C870E2816",
        "0xA70266C8F8Cf33647dcFEE763961aFf418D9E1E4",
        "0xd988097fb8612cc24eeC14542bC03424c656005f",
        true,
      ),
    ).toBe(34443);
  });

  it("returns undefined when no known leaf chain matches", () => {
    expect(
      deriveV2RootPoolLeafChain(
        ROOT_V2_FACTORY,
        "0x0000000000000000000000000000000000000001",
        "0xA70266C8F8Cf33647dcFEE763961aFf418D9E1E4",
        "0xd988097fb8612cc24eeC14542bC03424c656005f",
        true,
      ),
    ).toBeUndefined();
  });

  it("knows the superchain leaf chains (legacy chains but Optimism and Base)", () => {
    expect(SUPERCHAIN_LEAF_CHAIN_IDS).toContain(34443);
    expect(SUPERCHAIN_LEAF_CHAIN_IDS).not.toContain(10);
    expect(SUPERCHAIN_LEAF_CHAIN_IDS).not.toContain(8453);
  });
});

describe("RootPool on the root chain", () => {
  const clRoot = toChecksumAddress(
    "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
  );
  const v2Root = toChecksumAddress(
    "0x5b0DF9c40e3b571974167E642c15564C870E2816",
  );
  const token0 = toChecksumAddress(
    "0xFc00000000000000000000000000000000000001",
  );
  const token1 = toChecksumAddress(
    "0xFC00000000000000000000000000000000000006",
  );
  const clGauge = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const v2Gauge = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const voter = toChecksumAddress("0x3333333333333333333333333333333333333333");
  const zero = "0x0000000000000000000000000000000000000000";

  async function run() {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [OP]: {
          simulate: [
            {
              contract: "RootCLPoolFactory",
              event: "RootPoolCreated",
              srcAddress: ROOT_CL_FACTORY,
              logIndex: 1,
              block: block(127_697_794, 1_730_000_000),
              params: {
                token0,
                token1,
                tickSpacing: 100n,
                chainid: 252n,
                pool: clRoot,
              },
            },
            {
              contract: "RootPoolFactory",
              event: "PoolCreated",
              srcAddress: ROOT_V2_FACTORY,
              logIndex: 2,
              block: block(127_697_794, 1_730_000_000),
              params: {
                token0: toChecksumAddress(
                  "0xA70266C8F8Cf33647dcFEE763961aFf418D9E1E4",
                ),
                token1: toChecksumAddress(
                  "0xd988097fb8612cc24eeC14542bC03424c656005f",
                ),
                stable: true,
                pool: v2Root,
                length: 1n,
              },
            },
            ...[
              [clRoot, clGauge, 3],
              [v2Root, v2Gauge, 4],
            ].map(([pool, gauge, logIndex]) => ({
              contract: "Voter" as const,
              event: "GaugeCreated" as const,
              srcAddress: VOTER,
              logIndex: logIndex as number,
              block: block(127_697_800, 1_730_000_100),
              params: {
                poolFactory: zero,
                votingRewardsFactory: zero,
                gaugeFactory: zero,
                pool: pool as string,
                bribeVotingReward: zero,
                feeVotingReward: zero,
                gauge: gauge as string,
                creator: zero,
              },
            })),
            {
              contract: "Voter",
              event: "Voted",
              srcAddress: VOTER,
              logIndex: 5,
              block: block(127_706_456, 1_730_010_000),
              params: {
                voter,
                pool: clRoot,
                tokenId: 7n,
                weight: 100n,
                totalWeight: 100n,
                timestamp: 1n,
              },
            },
            {
              contract: "Voter",
              event: "Voted",
              srcAddress: VOTER,
              logIndex: 6,
              block: block(127_706_457, 1_730_010_002),
              params: {
                voter,
                pool: clRoot,
                tokenId: 8n,
                weight: 50n,
                totalWeight: 150n,
                timestamp: 1n,
              },
            },
            {
              contract: "Voter",
              event: "Abstained",
              srcAddress: VOTER,
              logIndex: 7,
              block: block(127_706_458, 1_730_010_004),
              params: {
                voter,
                pool: clRoot,
                tokenId: 7n,
                weight: 100n,
                totalWeight: 50n,
                timestamp: 1n,
              },
            },
            {
              contract: "Voter",
              event: "DistributeReward",
              srcAddress: VOTER,
              logIndex: 8,
              block: block(127_706_459, 1_730_010_006),
              params: { sender: voter, gauge: clGauge, amount: 10n ** 18n },
            },
            {
              contract: "Voter",
              event: "DistributeReward",
              srcAddress: VOTER,
              logIndex: 9,
              block: block(127_706_460, 1_730_010_008),
              params: {
                sender: voter,
                gauge: clGauge,
                amount: 2n * 10n ** 18n,
              },
            },
            {
              contract: "Voter",
              event: "GaugeKilled",
              srcAddress: VOTER,
              logIndex: 10,
              block: block(127_706_461, 1_730_010_010),
              params: { gauge: v2Gauge },
            },
          ],
        },
      },
    });
    return indexer;
  }

  it("creates CL and V2 root pools with their leaf chain, pair and gauge", async () => {
    const indexer = await run();
    const cl = await indexer.RootPool.get(RootPoolId(OP, clRoot));
    expect(cl).toMatchObject({
      leafChainId: 252,
      isCL: true,
      tickSpacing: 100n,
      rootFactoryAddress: ROOT_CL_FACTORY,
      rootPoolMatchingHash: `252_${token0}_${token1}_100`,
      gaugeAddress: clGauge,
      gaugeIsAlive: true,
    });
    const v2 = await indexer.RootPool.get(RootPoolId(OP, v2Root));
    expect(v2).toMatchObject({
      leafChainId: 34443,
      isCL: false,
      isStable: true,
      rootFactoryAddress: ROOT_V2_FACTORY,
      gaugeAddress: v2Gauge,
      gaugeIsAlive: false, // GaugeKilled
    });
    expect(v2?.rootPoolMatchingHash).toBeUndefined();
  });

  it("takes the pool weight from totalWeight and moves each veNFT's vote", async () => {
    const indexer = await run();
    expect(
      (await indexer.RootPool.get(RootPoolId(OP, clRoot)))?.veNFTamountStaked,
    ).toBe(50n);
    expect(
      (await indexer.RootPoolVote.get(RootPoolVoteId(OP, 7n, clRoot)))
        ?.veNFTamountStaked,
    ).toBe(0n);
    expect(
      await indexer.RootPoolVote.get(RootPoolVoteId(OP, 8n, clRoot)),
    ).toMatchObject({
      veNFTamountStaked: 50n,
      veNFTStateId: "10-8",
      rootPoolAddress: clRoot,
    });
  });

  it("adds every distribution to the root gauge's pool (no reward Token indexed: 18 decimals, no USD)", async () => {
    const indexer = await run();
    const cl = await indexer.RootPool.get(RootPoolId(OP, clRoot));
    expect(cl?.totalEmissions).toBe(3n * 10n ** 18n);
    expect(cl?.numberOfDistributions).toBe(2n);
    expect(cl?.totalEmissionsUSD).toBe(0n);
  });

  it("keeps the existing cross-chain path: votes without a leaf mapping stay pending", async () => {
    const indexer = await run();
    // no VeNFTState in this test, so the leaf path drops them exactly as before
    expect(await indexer.PendingVote.getAll()).toHaveLength(0);
    expect(await indexer.PendingDistribution.getAll()).toHaveLength(2);
  });
});
