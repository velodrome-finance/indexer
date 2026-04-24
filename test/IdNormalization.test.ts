import { describe, expect, it } from "vitest";
import {
  ALMLPWrapperId,
  ALMLPWrapperSnapshotId,
  ALMLPWrapperTransferInTxId,
  CLPoolMintEventId,
  CLPositionPendingPrincipalId,
  LiquidityPoolAggregatorSnapshotId,
  MailboxMessageId,
  NonFungiblePositionId,
  NonFungiblePositionSnapshotId,
  OUSDTSwapsId,
  PendingDistributionId,
  PendingRootPoolMappingId,
  PendingVoteId,
  PoolId,
  PoolTransferInTxId,
  RootGaugeRootPoolId,
  RootPoolLeafPoolId,
  SuperSwapId,
  TokenId,
  TokenIdByBlock,
  TxCLPoolMintRegistryId,
  UserStatsPerPoolId,
  UserStatsPerPoolSnapshotId,
  VeNFTPoolVoteId,
  VeNFTPoolVoteSnapshotId,
  rootPoolMatchingHash,
  toChecksumAddress,
} from "../src/Constants";

// Envio's `event.params.*` always supplies EIP-55 checksum-cased addresses.
// These tests pin the contract: every *Id helper preserves the checksum
// input verbatim — no internal lowercasing, no toChecksumAddress round-trip.
// If a future refactor adds normalization inside a helper, a write at
// checksum and a read at lowercase would silently key into different rows.

const CHAIN_ID = 8453;
const ROOT_CHAIN_ID = 10;
const POOL = toChecksumAddress("0x4d5300C67F4b59B67281Bb2d205795c29ad07ba6");
const POOL_2 = toChecksumAddress("0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F");
const TX_HASH =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const MSG_ID =
  "0xdead0123456789abcdef0123456789abcdef0123456789abcdef0123456789be";
const TOKEN_ID = 42n;
const TICK_LOWER = -100n;
const TICK_UPPER = 100n;
const EPOCH_MS = 1700000000000;
const BLOCK_NUMBER = 12345678;
const LOG_INDEX = 7;
const TICK_SPACING = 60n;
const AMOUNT_IN = 1000n;
const AMOUNT_OUT = 999n;

describe("ID helpers preserve EIP-55 checksum input (issue #633)", () => {
  // Each row exercises one *Id helper with checksum-cased inputs and asserts
  // the output equals the template-literal composition of those same inputs.
  // Adding a new helper to the contract = adding a new row here.
  const cases: ReadonlyArray<{
    name: string;
    actual: () => string;
    expected: string;
  }> = [
    {
      name: "PoolId",
      actual: () => PoolId(CHAIN_ID, POOL),
      expected: `${CHAIN_ID}-${POOL}`,
    },
    {
      name: "TokenId",
      actual: () => TokenId(CHAIN_ID, POOL),
      expected: `${CHAIN_ID}-${POOL}`,
    },
    {
      name: "TokenIdByBlock",
      actual: () => TokenIdByBlock(CHAIN_ID, POOL, BLOCK_NUMBER),
      expected: `${CHAIN_ID}-${POOL}-${BLOCK_NUMBER}`,
    },
    {
      name: "ALMLPWrapperId",
      actual: () => ALMLPWrapperId(CHAIN_ID, POOL),
      expected: `${CHAIN_ID}-${POOL}`,
    },
    {
      name: "UserStatsPerPoolId",
      actual: () => UserStatsPerPoolId(CHAIN_ID, POOL, POOL_2),
      expected: `${CHAIN_ID}-${POOL}-${POOL_2}`,
    },
    {
      name: "VeNFTPoolVoteId",
      actual: () => VeNFTPoolVoteId(CHAIN_ID, TOKEN_ID, POOL),
      expected: `${CHAIN_ID}-${TOKEN_ID}-${POOL}`,
    },
    {
      name: "RootPoolLeafPoolId",
      actual: () => RootPoolLeafPoolId(ROOT_CHAIN_ID, CHAIN_ID, POOL, POOL_2),
      expected: `${ROOT_CHAIN_ID}-${CHAIN_ID}-${POOL}-${POOL_2}`,
    },
    {
      name: "PendingVoteId",
      actual: () => PendingVoteId(CHAIN_ID, POOL, TOKEN_ID, TX_HASH, LOG_INDEX),
      expected: `${CHAIN_ID}-${POOL}-${TOKEN_ID}-${TX_HASH}-${LOG_INDEX}`,
    },
    {
      name: "PendingRootPoolMappingId",
      actual: () => PendingRootPoolMappingId(ROOT_CHAIN_ID, POOL),
      expected: `${ROOT_CHAIN_ID}-${POOL}`,
    },
    {
      name: "PendingDistributionId",
      actual: () =>
        PendingDistributionId(ROOT_CHAIN_ID, POOL, BLOCK_NUMBER, LOG_INDEX),
      expected: `${ROOT_CHAIN_ID}-${POOL}-${BLOCK_NUMBER}-${LOG_INDEX}`,
    },
    {
      name: "RootGaugeRootPoolId",
      actual: () => RootGaugeRootPoolId(ROOT_CHAIN_ID, POOL),
      expected: `${ROOT_CHAIN_ID}-${POOL}`,
    },
    {
      name: "rootPoolMatchingHash",
      actual: () => rootPoolMatchingHash(CHAIN_ID, POOL, POOL_2, TICK_SPACING),
      expected: `${CHAIN_ID}_${POOL}_${POOL_2}_${TICK_SPACING}`,
    },
    {
      name: "NonFungiblePositionId",
      actual: () => NonFungiblePositionId(CHAIN_ID, POOL, TOKEN_ID),
      expected: `${CHAIN_ID}-${POOL}-${TOKEN_ID}`,
    },
    {
      name: "PoolTransferInTxId",
      actual: () => PoolTransferInTxId(CHAIN_ID, TX_HASH, POOL, LOG_INDEX),
      expected: `${CHAIN_ID}-${TX_HASH}-${POOL}-${LOG_INDEX}`,
    },
    {
      name: "ALMLPWrapperTransferInTxId",
      actual: () =>
        ALMLPWrapperTransferInTxId(CHAIN_ID, TX_HASH, POOL, LOG_INDEX),
      expected: `${CHAIN_ID}-${TX_HASH}-${POOL}-${LOG_INDEX}`,
    },
    {
      name: "CLPoolMintEventId",
      actual: () => CLPoolMintEventId(CHAIN_ID, POOL, TX_HASH, LOG_INDEX),
      expected: `${CHAIN_ID}-${POOL}-${TX_HASH}-${LOG_INDEX}`,
    },
    {
      name: "TxCLPoolMintRegistryId",
      actual: () => TxCLPoolMintRegistryId(CHAIN_ID, TX_HASH),
      expected: `${CHAIN_ID}-${TX_HASH}`,
    },
    {
      name: "CLPositionPendingPrincipalId",
      actual: () =>
        CLPositionPendingPrincipalId(
          CHAIN_ID,
          POOL,
          POOL_2,
          TICK_LOWER,
          TICK_UPPER,
        ),
      expected: `${CHAIN_ID}-${POOL}-${POOL_2}-${TICK_LOWER}-${TICK_UPPER}`,
    },
    {
      name: "LiquidityPoolAggregatorSnapshotId",
      actual: () => LiquidityPoolAggregatorSnapshotId(CHAIN_ID, POOL, EPOCH_MS),
      expected: `${CHAIN_ID}-${POOL}-${EPOCH_MS}`,
    },
    {
      name: "MailboxMessageId",
      actual: () => MailboxMessageId(TX_HASH, CHAIN_ID, MSG_ID),
      expected: `${TX_HASH}-${CHAIN_ID}-${MSG_ID}`,
    },
    {
      name: "OUSDTSwapsId",
      actual: () =>
        OUSDTSwapsId(TX_HASH, CHAIN_ID, POOL, AMOUNT_IN, POOL_2, AMOUNT_OUT),
      expected: `${TX_HASH}-${CHAIN_ID}-${POOL}-${AMOUNT_IN}-${POOL_2}-${AMOUNT_OUT}`,
    },
    {
      name: "SuperSwapId",
      actual: () => SuperSwapId(MSG_ID),
      expected: MSG_ID,
    },
    {
      name: "UserStatsPerPoolSnapshotId",
      actual: () =>
        UserStatsPerPoolSnapshotId(CHAIN_ID, POOL, POOL_2, EPOCH_MS),
      expected: `${CHAIN_ID}-${POOL}-${POOL_2}-${EPOCH_MS}`,
    },
    {
      name: "NonFungiblePositionSnapshotId",
      actual: () =>
        NonFungiblePositionSnapshotId(CHAIN_ID, POOL, TOKEN_ID, EPOCH_MS),
      expected: `${CHAIN_ID}-${POOL}-${TOKEN_ID}-${EPOCH_MS}`,
    },
    {
      name: "ALMLPWrapperSnapshotId",
      actual: () => ALMLPWrapperSnapshotId(CHAIN_ID, POOL, EPOCH_MS),
      expected: `${CHAIN_ID}-${POOL}-${EPOCH_MS}`,
    },
    {
      name: "VeNFTPoolVoteSnapshotId",
      actual: () => VeNFTPoolVoteSnapshotId(CHAIN_ID, TOKEN_ID, POOL, EPOCH_MS),
      expected: `${CHAIN_ID}-${TOKEN_ID}-${POOL}-${EPOCH_MS}`,
    },
  ];

  it.each(cases)(
    "$name preserves checksum-cased input",
    ({ actual, expected }) => {
      expect(actual()).toBe(expected);
    },
  );

  it("regression #633: stale lowercased reader keys diverge from checksum writer keys; current reader matches writer", () => {
    // Simulate the two call sites involved in issue #633:
    //   - CLFactory writer: stores the pool keyed by event.params.pool (checksum-cased).
    //   - CLPoolLauncher reader: looks up that pool to link a launcher record.
    //
    // The bug was that the launcher reader called `.toLowerCase()` on the address
    // before invoking PoolId(), producing a different key than the writer and
    // silently missing the pool. The fix removes the lowercasing on the reader path.
    const writerId = PoolId(CHAIN_ID, POOL);

    // Pre-fix reader path: lowercased the address before keying. This MUST diverge
    // from the writer key — otherwise this regression test cannot fail on the bug
    // it claims to guard.
    const staleReaderId = PoolId(CHAIN_ID, POOL.toLowerCase());
    expect(writerId).not.toBe(staleReaderId);

    // Post-fix reader path: consumes event.params.pool unchanged, exactly like the
    // writer. Both call sites must land on the same key.
    const currentReaderId = PoolId(CHAIN_ID, POOL);
    expect(writerId).toBe(currentReaderId);

    // Pin the exact key shape, anchoring future refactors of PoolId().
    expect(writerId).toBe(`${CHAIN_ID}-${POOL}`);
  });
});
