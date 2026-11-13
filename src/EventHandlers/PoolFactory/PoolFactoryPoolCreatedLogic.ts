import type { Token } from "envio";
import { createPoolEntity } from "../../Aggregators/Pool";
import { type PoolDeployment, TokenId } from "../../Constants";
import type { TokenEntityMapping } from "../../CustomTypes";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { createTokenEntity } from "../../PriceOracle";
import { registerPricingPool } from "../../Pricing/PoolRoute";
import { getV2DefaultFee } from "../SwapFeeModule/CustomSwapFeeSharedLogic";

/** What a V2 PoolCreated tells us, whichever factory emitted it. */
export interface V2PoolCreatedInput {
  chainId: number;
  /** Factory that emitted PoolCreated (`event.srcAddress`). */
  factoryAddress: string;
  pool: string;
  token0: string;
  token1: string;
  isStable: boolean;
  blockNumber: number;
  /** Block timestamp in seconds. */
  blockTimestamp: number;
  deployment: PoolDeployment;
}

/**
 * Creates the Pool for a V2 PoolCreated and registers it as a pricing
 * candidate (ADR 0003). Shared by the legacy `PoolFactory` (stability from the
 * event's `stable` flag) and the Aero stable / volatile factories (stability
 * from which factory emitted it).
 *
 * Missing Token rows are created first (cached metadata RPC). A token side the
 * bytecode gate rejects (#677) gets no Token row but the Pool is still created
 * with an empty symbol on that side (#864): the factory has registered it.
 * The configured fee starts at the factory default for the pool type
 * (`getV2DefaultFee`: the factory's SetDefaultFee, else 5 / 30 bps), in
 * FEE_SCALE (ADR 0001).
 *
 * @param input - The PoolCreated data
 * @param context - Handler context
 * @returns Promise that resolves once the Pool and its pricing registration are staged
 */
export async function createV2PoolFromFactory(
  input: V2PoolCreatedInput,
  context: handlerContext,
): Promise<void> {
  const { chainId } = input;
  const [poolToken0, poolToken1] = await Promise.all([
    getRehydrated(context.Token, "Token", TokenId(chainId, input.token0)),
    getRehydrated(context.Token, "Token", TokenId(chainId, input.token1)),
  ]);

  const poolTokenAddressMappings: TokenEntityMapping[] = [
    { address: input.token0, tokenInstance: poolToken0 },
    { address: input.token1, tokenInstance: poolToken1 },
  ];

  // Create missing tokens in parallel.
  const missingTokenMappings = poolTokenAddressMappings.filter(
    (mapping) => mapping.tokenInstance === undefined,
  );
  if (missingTokenMappings.length > 0) {
    // createTokenEntity returns `null` only when the bytecode gate confirms
    // the address is a non-contract (issue #677). A thrown error (transient
    // RPC failure) is mapped to `undefined` by `.catch`.
    const createdTokens = await Promise.all(
      missingTokenMappings.map(
        (mapping): Promise<Token | null | undefined> =>
          createTokenEntity(
            mapping.address,
            chainId,
            input.blockNumber,
            context,
            input.blockTimestamp,
          ).catch((error) => {
            context.log.error(
              `Error in pool factory fetching token details for ${mapping.address} on chain ${chainId}: ${error}`,
            );
            return undefined;
          }),
      ),
    );
    for (let i = 0; i < missingTokenMappings.length; i++) {
      const created = createdTokens[i];
      if (created === null) {
        context.log.warn(
          `[PoolFactory.PoolCreated] Pool ${input.pool} on chain ${chainId} has non-contract token side ${missingTokenMappings[i].address}; persisting Pool with empty symbol on that side`,
        );
      } else if (created !== undefined) {
        missingTokenMappings[i].tokenInstance = created;
      }
    }
  }

  // Index-based so a missing token instance does not shift the other token's
  // symbol into the wrong slot (#864).
  const poolTokenSymbols = poolTokenAddressMappings.map(
    (m) => m.tokenInstance?.symbol ?? "",
  );

  const fee = await getV2DefaultFee(
    chainId,
    input.factoryAddress,
    input.isStable,
    context,
  );

  context.Pool.set(
    createPoolEntity({
      poolAddress: input.pool,
      chainId,
      deployment: input.deployment,
      isCL: false,
      isStable: input.isStable,
      token0Address: input.token0,
      token1Address: input.token1,
      token0Symbol: poolTokenSymbols[0],
      token1Symbol: poolTokenSymbols[1],
      timestamp: new Date(input.blockTimestamp * 1000),
      factoryAddress: input.factoryAddress,
      baseFee: fee,
      currentFee: fee,
      createdBlockNumber: BigInt(input.blockNumber),
    }),
  );

  // Record the pool as a pricing candidate for whichever side sits in the
  // higher pricing tier (ADR 0003).
  await registerPricingPool(
    context,
    chainId,
    input.pool,
    input.token0,
    input.token1,
  );
}
