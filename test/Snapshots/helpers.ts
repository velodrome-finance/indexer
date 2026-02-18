/**
 * Extracts the wrapper address from an ALMLPWrapper entity id.
 * Entity id format is ALMLPWrapperId: {chainId}-{wrapperAddress}; when the id
 * has no hyphen (legacy/fallback), the full id is the wrapper address.
 * Used by snapshot tests to derive expected wrapper without mirroring production logic inline.
 */
export function getWrapperAddressFromId(almLpWrapperId: string): string {
  return almLpWrapperId.includes("-")
    ? almLpWrapperId.split("-").slice(1).join("-")
    : almLpWrapperId;
}
