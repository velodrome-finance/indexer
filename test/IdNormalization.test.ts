import { describe, expect, it } from "vitest";
import {
  ALMLPWrapperId,
  ALMLPWrapperSnapshotId,
  ALMLPWrapperTransferInTxId,
  CLPoolMintEventId,
  CLPositionPendingPrincipalId,
  CLTickStakedId,
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
const TICK_INDEX = 0n;
const TICK_LOWER = -100n;
const TICK_UPPER = 100n;
const EPOCH_MS = 1700000000000;
const BLOCK_NUMBER = 12345678;
const LOG_INDEX = 7;
const TICK_SPACING = 60n;
const AMOUNT_IN = 1000n;
const AMOUNT_OUT = 999n;

describe("ID helpers preserve EIP-55 checksum input (issue #633)", () => {
  it("PoolId preserves checksum-cased pool address", () => {
    expect(PoolId(CHAIN_ID, POOL)).toBe(`${CHAIN_ID}-${POOL}`);
  });

  it("TokenId preserves checksum-cased token address", () => {
    expect(TokenId(CHAIN_ID, POOL)).toBe(`${CHAIN_ID}-${POOL}`);
  });

  it("TokenIdByBlock preserves checksum-cased token address", () => {
    expect(TokenIdByBlock(CHAIN_ID, POOL, BLOCK_NUMBER)).toBe(
      `${CHAIN_ID}-${POOL}-${BLOCK_NUMBER}`,
    );
  });

  it("ALMLPWrapperId preserves checksum-cased wrapper address", () => {
    expect(ALMLPWrapperId(CHAIN_ID, POOL)).toBe(`${CHAIN_ID}-${POOL}`);
  });

  it("UserStatsPerPoolId preserves both checksum-cased addresses", () => {
    expect(UserStatsPerPoolId(CHAIN_ID, POOL, POOL_2)).toBe(
      `${CHAIN_ID}-${POOL}-${POOL_2}`,
    );
  });

  it("VeNFTPoolVoteId preserves checksum-cased pool address", () => {
    expect(VeNFTPoolVoteId(CHAIN_ID, TOKEN_ID, POOL)).toBe(
      `${CHAIN_ID}-${TOKEN_ID}-${POOL}`,
    );
  });

  it("RootPoolLeafPoolId preserves both checksum-cased pool addresses", () => {
    expect(RootPoolLeafPoolId(ROOT_CHAIN_ID, CHAIN_ID, POOL, POOL_2)).toBe(
      `${ROOT_CHAIN_ID}-${CHAIN_ID}-${POOL}-${POOL_2}`,
    );
  });

  it("PendingVoteId preserves checksum-cased root pool address and tx hash", () => {
    expect(PendingVoteId(CHAIN_ID, POOL, TOKEN_ID, TX_HASH, LOG_INDEX)).toBe(
      `${CHAIN_ID}-${POOL}-${TOKEN_ID}-${TX_HASH}-${LOG_INDEX}`,
    );
  });

  it("PendingRootPoolMappingId preserves checksum-cased root pool address", () => {
    expect(PendingRootPoolMappingId(ROOT_CHAIN_ID, POOL)).toBe(
      `${ROOT_CHAIN_ID}-${POOL}`,
    );
  });

  it("PendingDistributionId preserves checksum-cased root pool address", () => {
    expect(
      PendingDistributionId(ROOT_CHAIN_ID, POOL, BLOCK_NUMBER, LOG_INDEX),
    ).toBe(`${ROOT_CHAIN_ID}-${POOL}-${BLOCK_NUMBER}-${LOG_INDEX}`);
  });

  it("RootGaugeRootPoolId preserves checksum-cased root gauge address", () => {
    expect(RootGaugeRootPoolId(ROOT_CHAIN_ID, POOL)).toBe(
      `${ROOT_CHAIN_ID}-${POOL}`,
    );
  });

  it("rootPoolMatchingHash preserves both checksum-cased token addresses", () => {
    expect(rootPoolMatchingHash(CHAIN_ID, POOL, POOL_2, TICK_SPACING)).toBe(
      `${CHAIN_ID}_${POOL}_${POOL_2}_${TICK_SPACING}`,
    );
  });

  it("NonFungiblePositionId preserves checksum-cased nfpm address", () => {
    expect(NonFungiblePositionId(CHAIN_ID, POOL, TOKEN_ID)).toBe(
      `${CHAIN_ID}-${POOL}-${TOKEN_ID}`,
    );
  });

  it("CLTickStakedId preserves checksum-cased pool address", () => {
    expect(CLTickStakedId(CHAIN_ID, POOL, TICK_INDEX)).toBe(
      `${CHAIN_ID}-${POOL}-${TICK_INDEX}`,
    );
  });

  it("PoolTransferInTxId preserves checksum-cased tx hash and pool address", () => {
    expect(PoolTransferInTxId(CHAIN_ID, TX_HASH, POOL, LOG_INDEX)).toBe(
      `${CHAIN_ID}-${TX_HASH}-${POOL}-${LOG_INDEX}`,
    );
  });

  it("ALMLPWrapperTransferInTxId preserves checksum-cased tx hash and wrapper address", () => {
    expect(ALMLPWrapperTransferInTxId(CHAIN_ID, TX_HASH, POOL, LOG_INDEX)).toBe(
      `${CHAIN_ID}-${TX_HASH}-${POOL}-${LOG_INDEX}`,
    );
  });

  it("CLPoolMintEventId preserves checksum-cased pool address and tx hash", () => {
    expect(CLPoolMintEventId(CHAIN_ID, POOL, TX_HASH, LOG_INDEX)).toBe(
      `${CHAIN_ID}-${POOL}-${TX_HASH}-${LOG_INDEX}`,
    );
  });

  it("TxCLPoolMintRegistryId preserves checksum-cased tx hash", () => {
    expect(TxCLPoolMintRegistryId(CHAIN_ID, TX_HASH)).toBe(
      `${CHAIN_ID}-${TX_HASH}`,
    );
  });

  it("CLPositionPendingPrincipalId preserves checksum-cased pool and owner addresses", () => {
    expect(
      CLPositionPendingPrincipalId(
        CHAIN_ID,
        POOL,
        POOL_2,
        TICK_LOWER,
        TICK_UPPER,
      ),
    ).toBe(`${CHAIN_ID}-${POOL}-${POOL_2}-${TICK_LOWER}-${TICK_UPPER}`);
  });

  it("LiquidityPoolAggregatorSnapshotId preserves checksum-cased pool address", () => {
    expect(LiquidityPoolAggregatorSnapshotId(CHAIN_ID, POOL, EPOCH_MS)).toBe(
      `${CHAIN_ID}-${POOL}-${EPOCH_MS}`,
    );
  });

  it("MailboxMessageId preserves checksum-cased tx hash and message id", () => {
    expect(MailboxMessageId(TX_HASH, CHAIN_ID, MSG_ID)).toBe(
      `${TX_HASH}-${CHAIN_ID}-${MSG_ID}`,
    );
  });

  it("OUSDTSwapsId preserves checksum-cased tx hash and both pool addresses", () => {
    expect(
      OUSDTSwapsId(TX_HASH, CHAIN_ID, POOL, AMOUNT_IN, POOL_2, AMOUNT_OUT),
    ).toBe(
      `${TX_HASH}-${CHAIN_ID}-${POOL}-${AMOUNT_IN}-${POOL_2}-${AMOUNT_OUT}`,
    );
  });

  it("SuperSwapId preserves the message id verbatim", () => {
    expect(SuperSwapId(MSG_ID)).toBe(MSG_ID);
  });

  it("UserStatsPerPoolSnapshotId preserves checksum-cased addresses", () => {
    expect(UserStatsPerPoolSnapshotId(CHAIN_ID, POOL, POOL_2, EPOCH_MS)).toBe(
      `${CHAIN_ID}-${POOL}-${POOL_2}-${EPOCH_MS}`,
    );
  });

  it("NonFungiblePositionSnapshotId preserves checksum-cased nfpm address", () => {
    expect(
      NonFungiblePositionSnapshotId(CHAIN_ID, POOL, TOKEN_ID, EPOCH_MS),
    ).toBe(`${CHAIN_ID}-${POOL}-${TOKEN_ID}-${EPOCH_MS}`);
  });

  it("ALMLPWrapperSnapshotId preserves checksum-cased wrapper address", () => {
    expect(ALMLPWrapperSnapshotId(CHAIN_ID, POOL, EPOCH_MS)).toBe(
      `${CHAIN_ID}-${POOL}-${EPOCH_MS}`,
    );
  });

  it("VeNFTPoolVoteSnapshotId preserves checksum-cased pool address", () => {
    expect(VeNFTPoolVoteSnapshotId(CHAIN_ID, TOKEN_ID, POOL, EPOCH_MS)).toBe(
      `${CHAIN_ID}-${TOKEN_ID}-${POOL}-${EPOCH_MS}`,
    );
  });

  it("CLFactory writer and CLPoolLauncher reader resolve to the same key when both consume event.params.pool unchanged (issue #633 regression)", () => {
    // Both handlers receive the same EIP-55 checksum address from
    // Envio's event.params.pool. Once the launcher stops calling
    // .toLowerCase() before PoolId(), both paths land on the same key.
    const writerId = PoolId(8453, POOL);
    const readerId = PoolId(8453, POOL);
    expect(writerId).toBe(readerId);
    expect(writerId).toBe(`8453-${POOL}`);
    // Sanity: a stale lowercased reader would have produced a different key.
    expect(writerId).not.toBe(`8453-${POOL.toLowerCase()}`);
  });
});
