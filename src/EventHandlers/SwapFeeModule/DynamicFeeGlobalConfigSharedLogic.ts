/**
 * Entity ID for DynamicFeeGlobalConfig. Format: {chainId}-{moduleAddress}.
 *
 * The swap fee modules are deployed at the same address on several superchain
 * leaf chains (e.g. CustomSwapFeeModule 0x6812…C238 on Soneium, Ink, Unichain,
 * Metal, Superseed and Swell; DynamicSwapFeeModule 0xbA3a…41Ca on Soneium, Ink,
 * Metal and Superseed), so the module address alone does not identify a row:
 * keyed by address, every chain wrote the same row and the last chain to index
 * won. Belongs next to the other id helpers in `src/Constants.ts`; kept here
 * until that file can be edited.
 * @param chainId - Chain the module emitted the event on
 * @param moduleAddress - Swap fee module address (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @returns string Combined DynamicFeeGlobalConfig ID.
 */
export const DynamicFeeGlobalConfigId = (
  chainId: number,
  moduleAddress: string,
): string => `${chainId}-${moduleAddress}`;
