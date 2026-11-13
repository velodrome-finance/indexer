import { indexer } from "envio";
import { ALMLPWrapperId } from "../../Constants";
import { findStrategyPosition } from "./DeployFactorySharedLogic";

indexer.contractRegister(
  { contract: "ALMDeployFactoryV1", event: "StrategyCreated" },
  async ({ event, context }) => {
    const { lpWrapper } = event.params.params;
    context.chain.ALMLPWrapperV1.add(lpWrapper);
  },
);

indexer.onEvent(
  { contract: "ALMDeployFactoryV1", event: "StrategyCreated" },
  async ({ event, context }) => {
    const { pool, ammPosition, strategyParams, lpWrapper } =
      event.params.params;

    const { strategyType, tickNeighborhood, tickSpacing, width } =
      strategyParams;

    // In DeployFactoryV1, ammPosition is a single tuple (V2 uses an array)
    // Contract relationship: 1 LP wrapper per pool, 1 strategy per LP wrapper, 1 tokenId per strategy, 1 AMM position per tokenId
    const { token0, token1, property, tickLower, tickUpper, liquidity } =
      ammPosition;

    const timestamp = new Date(event.block.timestamp * 1000);

    const position = await findStrategyPosition(
      event.chainId,
      event.transaction.hash,
      { pool, token0, token1, tickLower, tickUpper, liquidity },
      "[ALMDeployFactoryV1]",
      context,
    );

    if (!position) {
      context.log.error(
        `[ALMDeployFactoryV1] NonFungiblePosition not found for transaction hash ${event.transaction.hash} matching tickLower ${tickLower}, tickUpper ${tickUpper}, liquidity ${liquidity}. It should have been created by CLPool event handlers.`,
      );
      return;
    }

    const tokenId = position.tokenId;

    // In DeployFactoryV1, lpWrapper.initialize() receives position.liquidity as initialTotalSupply
    // and mints that amount as LP tokens. So the initial LP token supply equals the liquidity value.
    // Note: Unlike V2, V1 doesn't emit TotalSupplyLimitUpdated event, so we use liquidity directly.
    const initialTotalSupplyLPTokens = liquidity;

    // Create ALM_LP_Wrapper (single entity tracks both wrapper and strategy)
    // amount0/amount1 are derived at snapshot time from liquidity + sqrtPriceX96 + ticks
    context.ALM_LP_Wrapper.set({
      id: ALMLPWrapperId(event.chainId, lpWrapper),
      chainId: event.chainId,
      pool: pool,
      token0: token0,
      token1: token1,

      lpAmount: initialTotalSupplyLPTokens,
      lastUpdatedTimestamp: timestamp,

      tokenId: tokenId,
      tickLower: tickLower,
      tickUpper: tickUpper,
      property: property,
      liquidity: liquidity,
      strategyType: strategyType,
      tickNeighborhood: tickNeighborhood,
      tickSpacing: tickSpacing,
      positionWidth: width,
      maxLiquidityRatioDeviationX96: 0n, // Not present in DeployFactoryV1 strategyParams, defaulting to 0
      creationTimestamp: timestamp,
      strategyTransactionHash: event.transaction.hash,
      lastSnapshotTimestamp: undefined,
    });
  },
);
