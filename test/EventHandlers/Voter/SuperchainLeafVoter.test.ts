import type { Token } from "envio";
import { createTestIndexer } from "envio";
import * as PoolModule from "../../../src/Aggregators/Pool";
import {
  SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
  SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST,
  TokenId,
  toChecksumAddress,
} from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import {
  PRICE_TRUST_OUTCOME,
  PRICE_TRUST_REASON,
} from "../../../src/PriceTrust";
import { type MockPool, setupCommon } from "../Pool/common";

describe("SuperchainLeafVoter Events", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const { createMockPool } = setupCommon();

  describe("GaugeCreated Event", () => {
    const chainId = 10 as const;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );
    const blockTimestamp = 1000000;
    const blockNumber = 123456;

    describe("when pool entity exists", () => {
      let indexer: ReturnType<typeof createTestIndexer>;
      let mockLiquidityPool: MockPool;

      beforeEach(async () => {
        mockLiquidityPool = createMockPool({
          poolAddress: poolAddress,
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        });

        indexer = createTestIndexer();
        indexer.Pool.set(mockLiquidityPool);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "GaugeCreated",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    timestamp: blockTimestamp,
                    number: blockNumber,
                    hash: "0xhash",
                  },
                  params: {
                    poolFactory: toChecksumAddress(
                      "0xeAD23f606643E387a073D0EE8718602291ffaAeB",
                    ), // CL factory
                    votingRewardsFactory: toChecksumAddress(
                      "0x2222222222222222222222222222222222222222",
                    ),
                    gaugeFactory: toChecksumAddress(
                      "0x3333333333333333333333333333333333333333",
                    ),
                    pool: poolAddress,
                    incentiveVotingReward: toChecksumAddress(
                      "0x5555555555555555555555555555555555555555",
                    ),
                    feeVotingReward: toChecksumAddress(
                      "0x6666666666666666666666666666666666666666",
                    ),
                    gauge: gaugeAddress,
                  },
                },
              ],
            },
          },
        });
      });

      it("should update pool entity with gauge address and voting reward addresses", async () => {
        const rawPool = await indexer.Pool.get(mockLiquidityPool.id);
        const updatedPool = rawPool
          ? rehydrateTimestamps("Pool", rawPool)
          : undefined;
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          toChecksumAddress("0x6666666666666666666666666666666666666666"),
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          toChecksumAddress("0x5555555555555555555555555555555555555555"),
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(blockTimestamp * 1000),
        );
      });
    });

    it("calls addCLGauge when poolFactory is in SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST", async () => {
      const poolFactoryFromList = SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST[0];
      const clIndexer = createTestIndexer();

      await clIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "SuperchainLeafVoter",
                event: "GaugeCreated",
                srcAddress: toChecksumAddress(
                  "0x1111111111111111111111111111111111111111",
                ),
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: "0xhash",
                },
                params: {
                  poolFactory: poolFactoryFromList as `0x${string}`,
                  votingRewardsFactory: toChecksumAddress(
                    "0x2222222222222222222222222222222222222222",
                  ),
                  gaugeFactory: toChecksumAddress(
                    "0x3333333333333333333333333333333333333333",
                  ),
                  pool: poolAddress,
                  incentiveVotingReward: toChecksumAddress(
                    "0x5555555555555555555555555555555555555555",
                  ),
                  feeVotingReward: toChecksumAddress(
                    "0x6666666666666666666666666666666666666666",
                  ),
                  gauge: gaugeAddress,
                },
              },
            ],
          },
        },
      });

      expect(clIndexer).toBeDefined();
    });

    it("calls addGauge when poolFactory is in SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST", async () => {
      const poolFactoryFromList =
        SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST[0];
      const nonClIndexer = createTestIndexer();

      await nonClIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "SuperchainLeafVoter",
                event: "GaugeCreated",
                srcAddress: toChecksumAddress(
                  "0x1111111111111111111111111111111111111111",
                ),
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: "0xhash",
                },
                params: {
                  poolFactory: poolFactoryFromList as `0x${string}`,
                  votingRewardsFactory: toChecksumAddress(
                    "0x2222222222222222222222222222222222222222",
                  ),
                  gaugeFactory: toChecksumAddress(
                    "0x3333333333333333333333333333333333333333",
                  ),
                  pool: poolAddress,
                  incentiveVotingReward: toChecksumAddress(
                    "0x5555555555555555555555555555555555555555",
                  ),
                  feeVotingReward: toChecksumAddress(
                    "0x6666666666666666666666666666666666666666",
                  ),
                  gauge: gaugeAddress,
                },
              },
            ],
          },
        },
      });

      expect(nonClIndexer).toBeDefined();
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        const emptyIndexer = createTestIndexer();

        await emptyIndexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "GaugeCreated",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    timestamp: blockTimestamp,
                    number: blockNumber,
                    hash: "0xhash",
                  },
                  params: {
                    poolFactory: toChecksumAddress(
                      "0xeAD23f606643E387a073D0EE8718602291ffaAeB",
                    ),
                    votingRewardsFactory: toChecksumAddress(
                      "0x2222222222222222222222222222222222222222",
                    ),
                    gaugeFactory: toChecksumAddress(
                      "0x3333333333333333333333333333333333333333",
                    ),
                    pool: poolAddress,
                    incentiveVotingReward: toChecksumAddress(
                      "0x5555555555555555555555555555555555555555",
                    ),
                    feeVotingReward: toChecksumAddress(
                      "0x6666666666666666666666666666666666666666",
                    ),
                    gauge: gaugeAddress,
                  },
                },
              ],
            },
          },
        });

        const pools = await emptyIndexer.Pool.getAll();
        expect(pools).toHaveLength(0);
      });
    });
  });

  describe("WhitelistToken Event", () => {
    const chainId = 10 as const;
    // Real WETH on Optimism — has on-chain bytecode, so the #677
    // hasContractBytecode gate doesn't short-circuit Token creation.
    const tokenAddress = toChecksumAddress(
      "0x4200000000000000000000000000000000000006",
    );
    const blockTimestamp = 1000000;
    const blockNumber = 123456;

    describe("when token already exists", () => {
      const expectedPricePerUSDNew = BigInt(10000000);

      it("should update the existing token entity", async () => {
        const token: Token = {
          id: TokenId(chainId, tokenAddress),
          address: tokenAddress,
          symbol: "TEST",
          name: "TEST",
          chainId,
          decimals: BigInt(18),
          pricePerUSDNew: expectedPricePerUSDNew,
          isWhitelisted: false,
          lastUpdatedTimestamp: new Date(0),
        } as Token;

        const indexer = createTestIndexer();
        indexer.Token.set(token);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "WhitelistToken",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    token: tokenAddress,
                    _bool: true,
                  },
                },
              ],
            },
          },
        });

        const rawToken = await indexer.Token.get(
          TokenId(chainId, tokenAddress),
        );
        const updatedToken = rawToken
          ? rehydrateTimestamps("Token", rawToken)
          : undefined;
        expect(updatedToken).toBeDefined();
        expect(updatedToken?.isWhitelisted).toBe(true);
        expect(updatedToken?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
        expect(updatedToken?.lastUpdatedTimestamp).toBeInstanceOf(Date);
        expect(updatedToken?.lastUpdatedTimestamp?.getTime()).toBe(
          blockTimestamp * 1000,
        );
      });
    });

    describe("when token does not exist yet", () => {
      it("should create a new Token entity with whitelisted flag", async () => {
        const indexer = createTestIndexer();

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "WhitelistToken",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    token: tokenAddress,
                    _bool: true,
                  },
                },
              ],
            },
          },
        });

        const rawToken = await indexer.Token.get(
          TokenId(chainId, tokenAddress),
        );
        const createdToken = rawToken
          ? rehydrateTimestamps("Token", rawToken)
          : undefined;
        expect(createdToken).toBeDefined();
        expect(createdToken?.isWhitelisted).toBe(true);
        expect(createdToken?.pricePerUSDNew).toBe(0n);
        expect(typeof createdToken?.name).toBe("string");
        expect(typeof createdToken?.symbol).toBe("string");
        expect(createdToken?.address).toBe(tokenAddress);
        expect(createdToken?.lastUpdatedTimestamp).toBeInstanceOf(Date);
        expect(createdToken?.lastUpdatedTimestamp?.getTime()).toBe(
          blockTimestamp * 1000,
        );
      });
    });

    describe("when _bool is false (de-whitelisting)", () => {
      describe("when token already exists and is whitelisted", () => {
        const expectedPricePerUSDNew = BigInt(10000000);

        it("should update the existing token entity to de-whitelist it", async () => {
          const token: Token = {
            id: TokenId(chainId, tokenAddress),
            address: tokenAddress,
            symbol: "TEST",
            name: "TEST",
            chainId,
            decimals: BigInt(18),
            pricePerUSDNew: expectedPricePerUSDNew,
            isWhitelisted: true, // Initially whitelisted
            lastUpdatedTimestamp: new Date(0),
          } as Token;

          const indexer = createTestIndexer();
          indexer.Token.set(token);

          await indexer.process({
            chains: {
              [chainId]: {
                simulate: [
                  {
                    contract: "SuperchainLeafVoter",
                    event: "WhitelistToken",
                    srcAddress: toChecksumAddress(
                      "0x1111111111111111111111111111111111111111",
                    ),
                    logIndex: 1,
                    block: {
                      number: blockNumber,
                      timestamp: blockTimestamp,
                      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                    },
                    params: {
                      token: tokenAddress,
                      _bool: false,
                    },
                  },
                ],
              },
            },
          });

          const rawToken = await indexer.Token.get(
            TokenId(chainId, tokenAddress),
          );
          const updatedToken = rawToken
            ? rehydrateTimestamps("Token", rawToken)
            : undefined;
          expect(updatedToken).toBeDefined();
          expect(updatedToken?.isWhitelisted).toBe(false);
          expect(updatedToken?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
          expect(updatedToken?.lastUpdatedTimestamp).toBeInstanceOf(Date);
          expect(updatedToken?.lastUpdatedTimestamp?.getTime()).toBe(
            blockTimestamp * 1000,
          );
        });
      });

      describe("when token does not exist yet", () => {
        it("should create a new Token entity with isWhitelisted set to false", async () => {
          const indexer = createTestIndexer();

          await indexer.process({
            chains: {
              [chainId]: {
                simulate: [
                  {
                    contract: "SuperchainLeafVoter",
                    event: "WhitelistToken",
                    srcAddress: toChecksumAddress(
                      "0x1111111111111111111111111111111111111111",
                    ),
                    logIndex: 1,
                    block: {
                      number: blockNumber,
                      timestamp: blockTimestamp,
                      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                    },
                    params: {
                      token: tokenAddress,
                      _bool: false,
                    },
                  },
                ],
              },
            },
          });

          const rawToken = await indexer.Token.get(
            TokenId(chainId, tokenAddress),
          );
          const createdToken = rawToken
            ? rehydrateTimestamps("Token", rawToken)
            : undefined;
          expect(createdToken).toBeDefined();
          expect(createdToken?.isWhitelisted).toBe(false);
          expect(createdToken?.pricePerUSDNew).toBe(0n);
          expect(typeof createdToken?.name).toBe("string");
          expect(typeof createdToken?.symbol).toBe("string");
          expect(createdToken?.address).toBe(tokenAddress);
          expect(createdToken?.lastUpdatedTimestamp).toBeInstanceOf(Date);
          expect(createdToken?.lastUpdatedTimestamp?.getTime()).toBe(
            blockTimestamp * 1000,
          );
        });
      });
    });

    describe("priceTrust recomputation on existing tokens (issue #761)", () => {
      it("flips UNTRUSTED/NON_WL to TRUSTED/WL when WhitelistToken(true) lands", async () => {
        const existing = {
          id: TokenId(chainId, tokenAddress),
          address: tokenAddress,
          symbol: "TEST",
          name: "TEST",
          chainId,
          decimals: BigInt(18),
          pricePerUSDNew: BigInt(10000000),
          isWhitelisted: false,
          priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
          priceTrustReason: PRICE_TRUST_REASON.NON_WL,
          lastUpdatedTimestamp: new Date(0),
        } as Token;

        const indexer = createTestIndexer();
        indexer.Token.set(existing);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "WhitelistToken",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    token: tokenAddress,
                    _bool: true,
                  },
                },
              ],
            },
          },
        });

        const token = await indexer.Token.get(TokenId(chainId, tokenAddress));
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.priceTrustOutcome).toBe(PRICE_TRUST_OUTCOME.TRUSTED);
        expect(token?.priceTrustReason).toBe(PRICE_TRUST_REASON.WL);
      });

      it("flips TRUSTED/WL to UNTRUSTED/NON_WL when WhitelistToken(false) lands", async () => {
        const existing = {
          id: TokenId(chainId, tokenAddress),
          address: tokenAddress,
          symbol: "TEST",
          name: "TEST",
          chainId,
          decimals: BigInt(18),
          pricePerUSDNew: BigInt(10000000),
          isWhitelisted: true,
          priceTrustOutcome: PRICE_TRUST_OUTCOME.TRUSTED,
          priceTrustReason: PRICE_TRUST_REASON.WL,
          lastUpdatedTimestamp: new Date(0),
        } as Token;

        const indexer = createTestIndexer();
        indexer.Token.set(existing);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "WhitelistToken",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    token: tokenAddress,
                    _bool: false,
                  },
                },
              ],
            },
          },
        });

        const token = await indexer.Token.get(TokenId(chainId, tokenAddress));
        expect(token?.isWhitelisted).toBe(false);
        expect(token?.priceTrustOutcome).toBe(PRICE_TRUST_OUTCOME.UNTRUSTED);
        expect(token?.priceTrustReason).toBe(PRICE_TRUST_REASON.NON_WL);
      });

      it("flags an existing blacklisted token UNTRUSTED/BLACKLISTED on WhitelistToken(true)", async () => {
        // $Manatee on Optimism — present in src/PriceOverrides.ts BLACKLIST
        const blacklistedAddress = toChecksumAddress(
          "0x7909Bda52eAf7C3cc12745E727Eb527a485241D8",
        );
        const existing = {
          id: TokenId(chainId, blacklistedAddress),
          address: blacklistedAddress,
          symbol: "MANATEE",
          name: "MANATEE",
          chainId,
          decimals: BigInt(18),
          pricePerUSDNew: 0n,
          isWhitelisted: false,
          priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
          priceTrustReason: PRICE_TRUST_REASON.NON_WL,
          lastUpdatedTimestamp: new Date(0),
        } as Token;

        const indexer = createTestIndexer();
        indexer.Token.set(existing);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "WhitelistToken",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    token: blacklistedAddress,
                    _bool: true,
                  },
                },
              ],
            },
          },
        });

        const token = await indexer.Token.get(
          TokenId(chainId, blacklistedAddress),
        );
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.priceTrustOutcome).toBe(PRICE_TRUST_OUTCOME.UNTRUSTED);
        expect(token?.priceTrustReason).toBe(PRICE_TRUST_REASON.BLACKLISTED);
      });
    });
  });

  describe("GaugeKilled Event", () => {
    const chainId = 10 as const;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );
    const blockTimestamp = 1000000;
    const blockNumber = 123456;

    describe("when pool entity exists", () => {
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

      it("should set gaugeIsAlive to false but preserve gauge address and voting reward addresses as historical data", async () => {
        const mockLiquidityPool = createMockPool({
          poolAddress: poolAddress,
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Initially has gauge address
          gaugeIsAlive: true, // Initially alive
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        });

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(
          mockLiquidityPool,
        );

        const indexer = createTestIndexer();
        indexer.Pool.set(mockLiquidityPool);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "GaugeKilled",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0xhash",
                  },
                  params: {
                    gauge: gaugeAddress,
                  },
                },
              ],
            },
          },
        });

        const rawPool = await indexer.Pool.get(mockLiquidityPool.id);
        const updatedPool = rawPool
          ? rehydrateTimestamps("Pool", rawPool)
          : undefined;
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(false); // Should be set to false
        // Gauge address should be preserved as historical data
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        // Voting reward addresses should be preserved as historical data
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          feeVotingRewardAddress,
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          bribeVotingRewardAddress,
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(blockTimestamp * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        // Mock findPoolByGaugeAddress to return null
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(null);

        const indexer = createTestIndexer();

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "GaugeKilled",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0xhash",
                  },
                  params: {
                    gauge: gaugeAddress,
                  },
                },
              ],
            },
          },
        });

        const pools = await indexer.Pool.getAll();
        expect(pools).toHaveLength(0);
      });
    });
  });

  describe("GaugeRevived Event", () => {
    const chainId = 10 as const;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );
    const blockTimestamp = 1000000;
    const blockNumber = 123456;

    describe("when pool entity exists", () => {
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

      it("should set gaugeIsAlive to true", async () => {
        const mockLiquidityPool = createMockPool({
          poolAddress: poolAddress,
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Has gauge address
          gaugeIsAlive: false, // Initially killed
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        });

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(
          mockLiquidityPool,
        );

        const indexer = createTestIndexer();
        indexer.Pool.set(mockLiquidityPool);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "GaugeRevived",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0xhash",
                  },
                  params: {
                    gauge: gaugeAddress,
                  },
                },
              ],
            },
          },
        });

        const rawPool = await indexer.Pool.get(mockLiquidityPool.id);
        const updatedPool = rawPool
          ? rehydrateTimestamps("Pool", rawPool)
          : undefined;
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(true); // Should be set to true
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(blockTimestamp * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        // Mock findPoolByGaugeAddress to return null
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(null);

        const indexer = createTestIndexer();

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainLeafVoter",
                  event: "GaugeRevived",
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: "0xhash",
                  },
                  params: {
                    gauge: gaugeAddress,
                  },
                },
              ],
            },
          },
        });

        const pools = await indexer.Pool.getAll();
        expect(pools).toHaveLength(0);
      });
    });
  });
});
