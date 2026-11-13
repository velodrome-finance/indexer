import type { PoolTickMap } from "envio";
import type { handlerContext } from "../EntityTypes";

/**
 * The two per-tick liquidityNet maps of a CL pool (total and staked), kept on
 * the Postgres-only `PoolTickMap` entity instead of the Pool row. Read only by
 * the code that walks or edits them (CLPool Swap / Mint / Burn, gauge
 * deposit / withdraw, NFPM staked-position liquidity changes); written only
 * when a map actually changes.
 */

/** A replacement for one or both maps; each pair is replaced whole. */
export interface PoolTickMapUpdate {
  tickEdges?: readonly bigint[];
  tickEdgeNets?: readonly bigint[];
  stakedTickEdges?: readonly bigint[];
  stakedTickEdgeNets?: readonly bigint[];
}

/**
 * Loads a pool's tick maps, or empty maps when none has been written yet (no
 * Mint and no stake so far).
 *
 * @param poolId - Pool id (`PoolId(chainId, poolAddress)`), also the map's id
 * @param context - Handler context
 * @returns The stored PoolTickMap, or an unsaved empty one with that id
 */
export async function loadPoolTickMap(
  poolId: string,
  context: handlerContext,
): Promise<PoolTickMap> {
  const existing = await context.PoolTickMap.get(poolId);
  return (
    existing ?? {
      id: poolId,
      tickEdges: [],
      tickEdgeNets: [],
      stakedTickEdges: [],
      stakedTickEdgeNets: [],
    }
  );
}

/**
 * Validates one (edges, nets) pair of an update: both or neither must be set,
 * with equal lengths. A broken pair is logged and dropped so the stored map
 * keeps its prior consistent state (same rule `updatePool` applied while the
 * maps lived on Pool).
 */
function validPair(
  edges: readonly bigint[] | undefined,
  nets: readonly bigint[] | undefined,
  tag: string,
  label: string,
  poolId: string,
  context: handlerContext,
): boolean {
  if (edges === undefined && nets === undefined) return false;
  if (edges === undefined || nets === undefined) {
    context.log.error(
      `[${tag}][setPoolTickMap] ${label} edges and nets must be updated together (parallel arrays) for pool ${poolId}. Got edges=${edges === undefined ? "unset" : "set"}, nets=${nets === undefined ? "unset" : "set"}. Dropping both; the map keeps its prior consistent pair.`,
    );
    return false;
  }
  if (edges.length !== nets.length) {
    context.log.error(
      `[${tag}][setPoolTickMap] ${label} edges/nets length mismatch for pool ${poolId}: edges.length=${edges.length}, nets.length=${nets.length}. Dropping both; the map keeps its prior consistent pair.`,
    );
    return false;
  }
  return true;
}

/**
 * Stages a write of a pool's tick maps with the given pair(s) replaced.
 * Callers pass only pairs that changed; when no valid pair remains nothing is
 * written, so an event that leaves both maps as they were costs no write.
 *
 * @param current - The map as loaded by {@link loadPoolTickMap}
 * @param update - Replacement pair(s); each pair must be complete and length-matched
 * @param context - Handler context
 * @returns The map as it now stands (the written one, or `current` when nothing was written)
 */
export function setPoolTickMap(
  current: PoolTickMap,
  update: PoolTickMapUpdate,
  context: handlerContext,
): PoolTickMap {
  const totalOk = validPair(
    update.tickEdges,
    update.tickEdgeNets,
    "TICK_EDGE_DRIFT",
    "tick",
    current.id,
    context,
  );
  const stakedOk = validPair(
    update.stakedTickEdges,
    update.stakedTickEdgeNets,
    "STAKED_TICK_DRIFT",
    "staked tick",
    current.id,
    context,
  );
  if (!totalOk && !stakedOk) return current;
  const next: PoolTickMap = {
    ...current,
    ...(totalOk
      ? {
          tickEdges: update.tickEdges as readonly bigint[],
          tickEdgeNets: update.tickEdgeNets as readonly bigint[],
        }
      : {}),
    ...(stakedOk
      ? {
          stakedTickEdges: update.stakedTickEdges as readonly bigint[],
          stakedTickEdgeNets: update.stakedTickEdgeNets as readonly bigint[],
        }
      : {}),
  };
  context.PoolTickMap.set(next);
  return next;
}
