// Project-side shim for envio types. Two responsibilities:
//
// 1. Re-export the GraphQL entity types `Pool`/`PoolSnapshot`. Pre-v3 these were
//    imported from `generated/src/Types` to dodge the #709 collision, where the
//    V2 `Pool` *contract* value re-export shadowed the `Pool` *entity* type at the
//    `generated` barrel. HyperIndex v3 drops per-contract value namespaces in
//    favor of the single `indexer` value, so the plain `envio` re-export is now
//    unambiguous and this module stays the single project-side path for them.
// 2. Alias the unified handler context type (see `handlerContext` below).
import type { EvmOnEventContext } from "envio";

export type { Pool, PoolSnapshot } from "envio";

/**
 * Unified handler-context type used throughout the aggregators, snapshots, and
 * event-handler logic. HyperIndex v3 renamed the generated `handlerContext`
 * type to `EvmOnEventContext`; this alias preserves the project's long-standing
 * name across its ~500 call sites, keeping the v3 migration surgical.
 */
export type handlerContext = EvmOnEventContext;
