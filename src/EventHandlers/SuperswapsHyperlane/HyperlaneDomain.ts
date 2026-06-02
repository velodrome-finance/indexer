/**
 * Hyperlane domain IDs whose value diverges from the chain's EVM chainId.
 *
 * Hyperlane identifies a destination chain by a uint32 "domain". For almost
 * every chain Velodrome/Aerodrome indexes, the domain is numerically identical
 * to the EVM chainId, so historically the two were used interchangeably. A few
 * chains diverge; this table maps those domains back to their canonical chainId.
 *
 * As of this writing the only divergence across the 12 indexed chains is Metal
 * (domain 1000001750 -> chainId 1750), verified against the Hyperlane registry
 * (chains/metal/metadata.yaml: chainId 1750, domainId 1000001750). All other
 * indexed chains (Optimism, Base, Celo, Soneium, Ink, Mode, Lisk, Unichain,
 * Fraxtal, Superseed, Swell) have domainId === chainId.
 *
 * Keyed by the decimal string form of the domain, since bigint cannot be used
 * as an object key directly.
 */
const DOMAIN_TO_CHAIN_ID: Record<string, bigint> = {
  "1000001750": 1750n, // Metal
};

/**
 * Resolves a Hyperlane destination domain ID to its EVM chainId.
 *
 * Divergent domains listed in {@link DOMAIN_TO_CHAIN_ID} are mapped to their
 * chainId; every other domain is returned unchanged, since domain === chainId
 * for those chains. An unlisted divergent domain therefore passes through as-is
 * (the pre-fix behavior), so any future chain whose domainId differs from its
 * chainId must be added to the table above to be stored correctly.
 *
 * @param domain - The Hyperlane uint32 domain ID as emitted on-chain.
 * @returns The resolved EVM chainId — mapped when divergent, identity otherwise.
 */
export function domainToChainId(domain: bigint): bigint {
  return DOMAIN_TO_CHAIN_ID[domain.toString()] ?? domain;
}
