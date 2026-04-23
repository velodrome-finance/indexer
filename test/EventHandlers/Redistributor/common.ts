/**
 * Build the `mockEventData` shape shared by Redistributor event fixtures.
 *
 * Every Redistributor test case passes the same keys (`block`, `chainId`,
 * `logIndex`, `srcAddress`, `transaction.hash`); only a handful vary across
 * cases. Centralising construction here keeps individual tests focused on the
 * field(s) they are actually asserting on.
 *
 * @param fields - Per-test overrides for the varying fields
 * @returns The `mockEventData` object to pass into a Redistributor mock event
 */
type HexString = `0x${string}`;

// Callers typically pass `toChecksumAddress(...)` or inline hex literals whose
// types widen to `string` before reaching the helper; the generated mock APIs
// demand `0x${string}` template-literal types. Narrow once here so each test
// case doesn't need its own cast.
const asHex = (value: string): HexString => value as HexString;

export const makeRedistributorMockEventData = (fields: {
  blockNumber: number;
  timestamp: number;
  blockHash: string;
  logIndex: number;
  chainId: number;
  srcAddress: string;
  txHash: string;
}) => ({
  block: {
    number: fields.blockNumber,
    timestamp: fields.timestamp,
    hash: asHex(fields.blockHash),
  },
  chainId: fields.chainId,
  logIndex: fields.logIndex,
  srcAddress: asHex(fields.srcAddress),
  transaction: { hash: asHex(fields.txHash) },
});
