// Token-related effects
export {
  getTokenDetails,
  getTokenPrice,
  roundBlockToInterval,
} from "./Token";

// Uniswap-v4-cache-compatible metadata effect underneath getTokenDetails
export { getTokenMetadata } from "./TokenMetadata";

export { getSwapFee } from "./SwapFee";

// Bytecode-gate effect (filters EOAs / non-contract addresses at Token creation sites)
export { hasContractBytecode } from "./Bytecode";

// Canonical source's hourly price from ClickHouse (ADR 0009, flow F)
export {
  getCanonicalPriceSettings,
  getCanonicalSourcePrice,
} from "./CanonicalSourcePrice";

// Canonical source's price read from its own chain over RPC (ADR 0010)
export {
  getCanonicalRpcStats,
  getCanonicalSourceRpcPrice,
} from "./CanonicalSourceRpcPrice";

// RPC observability
export { getRpcStats } from "./RpcGateway";
