/**
 * Central registry of every entity field declared as GraphQL `Timestamp` (TS
 * type `Date`) in schema.graphql, keyed by entity name.
 *
 * Why this exists: envio v3.0.2's test harness (`createTestIndexer`) runs
 * handlers in a worker thread and serves pre-seeded entities through a proxy
 * that JSON-encodes them. `Timestamp` fields therefore arrive in handlers as
 * ISO **strings** on read, and writing such an entity back crashes the proxy's
 * serializer (`date.toISOString is not a function`). Production is unaffected —
 * the `postgres` driver returns native `Date`s — so {@link rehydrateTimestamps}
 * is a verified no-op there and only fires under the test proxy.
 *
 * This registry is kept in lockstep with schema.graphql by
 * test/EntityTimestamps.test.ts: adding or removing a `Timestamp` field without
 * updating this map fails that test, so the normalization can never silently
 * drift out of coverage.
 */
export const ENTITY_TIMESTAMP_FIELDS = {
  ALM_LP_Wrapper: [
    "lastUpdatedTimestamp",
    "creationTimestamp",
    "lastSnapshotTimestamp",
  ],
  ALM_LP_WrapperSnapshot: [
    "lastUpdatedTimestamp",
    "creationTimestamp",
    "timestamp",
  ],
  ALMLPWrapperTransferInTx: ["timestamp"],
  CLGaugeConfig: ["lastUpdatedTimestamp"],
  CLPoolMintEvent: ["createdAt"],
  FactoryRegistryConfig: ["lastUpdatedTimestamp"],
  FeeToTickSpacingMapping: ["lastUpdatedTimestamp"],
  NonFungiblePosition: ["lastUpdatedTimestamp", "lastSnapshotTimestamp"],
  NonFungiblePositionSnapshot: ["lastUpdatedTimestamp", "timestamp"],
  PendingDistribution: ["blockTimestamp"],
  PendingVote: ["timestamp"],
  Pool: ["lastUpdatedTimestamp", "lastSnapshotTimestamp"],
  PoolLauncherPool: ["createdAt", "lastFlagUpdateAt", "lastMigratedAt"],
  PoolSnapshot: ["timestamp"],
  PoolTransferInTx: ["timestamp"],
  RedistributorConfig: ["lastUpdatedTimestamp"],
  SuperSwap: ["timestamp"],
  Token: ["lastUpdatedTimestamp", "lastSuccessfulPriceTimestamp"],
  TokenPriceSnapshot: ["lastUpdatedTimestamp"],
  UserStatsPerPool: [
    "lastAlmActivityTimestamp",
    "firstActivityTimestamp",
    "lastActivityTimestamp",
    "lastSnapshotTimestamp",
  ],
  UserStatsPerPoolSnapshot: [
    "timestamp",
    "lastAlmActivityTimestamp",
    "lastActivityTimestamp",
  ],
  VeNFTPoolVote: ["lastUpdatedTimestamp"],
  VeNFTPoolVoteSnapshot: ["lastUpdatedTimestamp", "timestamp"],
  VeNFTState: ["lastUpdatedTimestamp", "lastSnapshotTimestamp"],
  VeNFTStateSnapshot: ["lastUpdatedTimestamp", "timestamp"],
} as const satisfies Record<string, readonly string[]>;

/** Name of any entity that carries one or more `Timestamp` fields. */
export type TimestampEntityName = keyof typeof ENTITY_TIMESTAMP_FIELDS;

/**
 * Normalizes an entity's `Timestamp` fields back to `Date` when they arrive as
 * strings. Behaviour-neutral in production (the fields are already `Date`s, so
 * the loop matches nothing and the original reference is returned with zero
 * allocation); under envio's `createTestIndexer` proxy the fields arrive as ISO
 * strings and are reconstructed. Returns a new object only when a coercion is
 * actually needed — entities are immutable, so existing fields are preserved
 * via spread.
 *
 * @param entityName - Entity whose `Timestamp` fields should be normalized
 * @param entity - Entity just read from storage (`context.<Entity>.get`)
 * @returns The same entity with every `Timestamp` field guaranteed to be `Date`
 */
export function rehydrateTimestamps<E>(
  entityName: TimestampEntityName,
  entity: E,
): E {
  let result = entity;
  for (const field of ENTITY_TIMESTAMP_FIELDS[entityName]) {
    const value = (result as Record<string, unknown>)[field];
    if (typeof value === "string") {
      result = {
        ...result,
        [field]: new Date(value),
      } as E;
    }
  }
  return result;
}

/**
 * Reads an entity by id and rehydrates its `Timestamp` fields in one step — the
 * drop-in replacement for `context.<Entity>.get(id)` at read-modify-write
 * sites. See {@link rehydrateTimestamps} for why this is needed and why it is a
 * no-op in production.
 *
 * @param store - The entity store, e.g. `context.Pool`
 * @param entityName - Entity name used to look up its `Timestamp` fields
 * @param id - Entity id to read
 * @returns The rehydrated entity, or `undefined` when not found
 */
export async function getRehydrated<E>(
  store: { get: (id: string) => Promise<E | undefined> },
  entityName: TimestampEntityName,
  id: string,
): Promise<E | undefined> {
  const entity = await store.get(id);
  return entity === undefined
    ? undefined
    : rehydrateTimestamps(entityName, entity);
}

/**
 * `getWhere` companion to {@link getRehydrated}: runs a `getWhere` query and
 * rehydrates the `Timestamp` fields of every matched entity in one step — the
 * drop-in replacement for `context.<Entity>.getWhere(filter)` whenever the
 * results are written back or have `Date` methods called on them. See
 * {@link rehydrateTimestamps} for why this is needed and why it is a no-op in
 * production.
 *
 * @param store - The entity store exposing `getWhere`, e.g. `context.Pool`
 * @param entityName - Entity name used to look up its `Timestamp` fields
 * @param filter - The `getWhere` filter, forwarded verbatim
 * @returns The matched entities, each with `Timestamp` fields guaranteed `Date`
 */
export async function getWhereRehydrated<E, F>(
  store: { getWhere: (filter: F) => Promise<E[]> },
  entityName: TimestampEntityName,
  filter: F,
): Promise<E[]> {
  const entities = (await store.getWhere(filter)) ?? [];
  return entities.map((entity) => rehydrateTimestamps(entityName, entity));
}
