# Mapping of Tables to Ethereum Events and Properties

## 1. velodrome_v2_optimism.PoolFactory_evt_PoolCreated
- **Event: `PoolCreated` from `PoolFactory`**
  - `pool` → `pool`
  - `token0` → `token0`
  - `token1` → `token1`
  - `stable` → `stable`

## 2. velodrome_v2_optimism.CLFactory_evt_PoolCreated
- **Event: `PoolCreated` from `CLFactory`**
  - `pool` → `pool`
  - `token0` → `token0`
  - `token1` → `token1`
  - `tickSpacing` → `tickSpacing`

## 3. velodrome_v2_optimism.PoolFactory_evt_SetCustomFee
- **Event: `SetCustomFee` from `PoolFactory`**
  - `pool` → `pool`
  - `fee` → `fee`

## 4. velodrome_v2_optimism.Voter_evt_GaugeCreated
- **Event: `GaugeCreated` from `Voter`**
  - `pool` → `pool`
  - `gauge` → `gauge`
  - `bribeVotingReward` → `bribeVotingReward`
  - `feeVotingReward` → `feeVotingReward`

## 5. velodrome_v2_optimism.PriceFetcher_evt_PriceFetched
- **Event: `PriceFetched` from `PriceFetcher`**
  - `token` → `token`
  - `price` → `price`

