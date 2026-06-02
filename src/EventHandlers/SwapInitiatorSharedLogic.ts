import { toChecksumAddress } from "../Constants";

/**
 * Resolves the end-user that a swap-like event should be attributed to.
 *
 * Per-user `UserStatsPerPool` stats (swap volume, contributed fees, swap
 * counts) must accrue to the account that initiated the swap, not to
 * `event.params.sender`. For the overwhelming majority of swaps `sender` is the
 * router/aggregator contract (e.g. the Aerodrome Router) that called the pool
 * on the user's behalf, so attributing to it credits router addresses with
 * users' activity (#814).
 *
 * `event.transaction.from` — the transaction signer — is the closest on-chain
 * proxy for "who initiated the swap" and is routing-invariant, unlike
 * `to`/`recipient` which on multi-hop intermediate legs point at the next pool
 * rather than the user. It is checksummed here because transaction fields
 * (unlike event params, which arrive EIP-55 cased) are not guaranteed to be
 * checksummed, and `UserStatsPerPoolId` keys the address verbatim.
 *
 * Limitation: for ERC-4337 / smart-contract-wallet transactions `from` is the
 * bundler/relayer rather than the userOp sender, so those (~0.5% of swaps) are
 * attributed to the bundler. There is no on-chain field that is unambiguously
 * the end user; `from` is strictly better than `sender`, which is the router in
 * essentially 100% of routed swaps. The `sender` fallback only guards the
 * `from === undefined` case, which cannot occur in production because `"from"`
 * is selected in `config.yaml`'s `transaction_fields` (the field is typed
 * nullable only because transaction-field selection is dynamic).
 *
 * @param event - A swap-like event (V2 Pool Swap/Fees or CL Pool Swap) carrying
 *   the transaction signer (`transaction.from`) and the calling address
 *   (`params.sender`).
 * @returns The checksummed transaction signer, or `params.sender` when `from`
 *   is absent.
 */
export function resolveSwapInitiator(event: {
  readonly transaction: { readonly from: string | undefined };
  readonly params: { readonly sender: string };
}): string {
  return event.transaction.from
    ? toChecksumAddress(event.transaction.from)
    : event.params.sender;
}
