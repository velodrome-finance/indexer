import { describe, expect, it } from "vitest";
import { toChecksumAddress } from "../../src/Constants";
import { resolveSwapInitiator } from "../../src/EventHandlers/SwapInitiatorSharedLogic";

describe("resolveSwapInitiator (#814)", () => {
  const router = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  // Lower-cased and full of hex letters so its EIP-55 form differs from input.
  const userLower = "0xaaaabbbbccccddddeeeeffff0000111122223333";
  const userChecksummed = toChecksumAddress(userLower);

  it("returns the checksummed tx signer when transaction.from is present", () => {
    const result = resolveSwapInitiator({
      transaction: { from: userLower },
      params: { sender: router },
    });
    expect(result).toBe(userChecksummed);
    // Guards against keying the same user under two casings.
    expect(result).not.toBe(userLower);
  });

  it("falls back to params.sender when transaction.from is undefined", () => {
    const result = resolveSwapInitiator({
      transaction: { from: undefined },
      params: { sender: router },
    });
    expect(result).toBe(router);
  });
});
