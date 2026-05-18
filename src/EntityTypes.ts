import type {
  EvmContractRegisterContext,
  EvmEvent,
  EvmOnEventContext,
} from "envio";

export type handlerContext = EvmOnEventContext;
export type contractRegisterContext = EvmContractRegisterContext;

export type CLFactory_PoolCreated_event = EvmEvent<"CLFactory", "PoolCreated">;
export type CLFactory_TickSpacingEnabled_event = EvmEvent<
  "CLFactory",
  "TickSpacingEnabled"
>;

export type CLPool_Burn_event = EvmEvent<"CLPool", "Burn">;
export type CLPool_Collect_event = EvmEvent<"CLPool", "Collect">;
export type CLPool_CollectFees_event = EvmEvent<"CLPool", "CollectFees">;
export type CLPool_Flash_event = EvmEvent<"CLPool", "Flash">;
export type CLPool_Mint_event = EvmEvent<"CLPool", "Mint">;
export type CLPool_Swap_event = EvmEvent<"CLPool", "Swap">;

export type Pool_Burn_event = EvmEvent<"Pool", "Burn">;
export type Pool_Claim_event = EvmEvent<"Pool", "Claim">;
export type Pool_Fees_event = EvmEvent<"Pool", "Fees">;
export type Pool_Mint_event = EvmEvent<"Pool", "Mint">;
export type Pool_Swap_event = EvmEvent<"Pool", "Swap">;
export type Pool_Sync_event = EvmEvent<"Pool", "Sync">;
export type Pool_Transfer_event = EvmEvent<"Pool", "Transfer">;

export type NFPM_DecreaseLiquidity_event = EvmEvent<
  "NFPM",
  "DecreaseLiquidity"
>;
export type NFPM_IncreaseLiquidity_event = EvmEvent<
  "NFPM",
  "IncreaseLiquidity"
>;
export type NFPM_Transfer_event = EvmEvent<"NFPM", "Transfer">;

export type VeNFT_Deposit_event = EvmEvent<"VeNFT", "Deposit">;
export type VeNFT_DepositManaged_event = EvmEvent<"VeNFT", "DepositManaged">;
export type VeNFT_LockPermanent_event = EvmEvent<"VeNFT", "LockPermanent">;
export type VeNFT_Merge_event = EvmEvent<"VeNFT", "Merge">;
export type VeNFT_Split_event = EvmEvent<"VeNFT", "Split">;
export type VeNFT_Transfer_event = EvmEvent<"VeNFT", "Transfer">;
export type VeNFT_UnlockPermanent_event = EvmEvent<"VeNFT", "UnlockPermanent">;
export type VeNFT_Withdraw_event = EvmEvent<"VeNFT", "Withdraw">;
export type VeNFT_WithdrawManaged_event = EvmEvent<"VeNFT", "WithdrawManaged">;

export type { Pool, PoolSnapshot } from "envio";
