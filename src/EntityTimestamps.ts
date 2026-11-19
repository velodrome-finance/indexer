/**
 * Pass-through read helpers kept for their call sites.
 *
 * History: envio v3.0.2's test harness (`createTestIndexer`) served entities
 * through a proxy that JSON-encoded them, so `Timestamp` fields arrived in
 * handlers as ISO strings and these helpers turned them back into `Date`s.
 * From envio 3.16 the harness runs in-process and hands out `Date`s, as
 * production always did, so nothing is left to convert: the whole test suite
 * passes with the conversion switched off. The helpers now only forward the
 * call, without an extra async frame per read (they sit on the hottest read
 * paths). New code should call `context.<Entity>.get` / `getWhere` directly.
 */

/** Entity name argument of the helpers below; unused, kept for call sites. */
export type TimestampEntityName = string;

/**
 * Returns the entity unchanged. See the file header.
 *
 * @param _entityName - Unused
 * @param entity - Entity just read from storage
 * @returns The same entity
 */
export function rehydrateTimestamps<E>(
  _entityName: TimestampEntityName,
  entity: E,
): E {
  return entity;
}

/**
 * Reads an entity by id: the same as `store.get(id)`. See the file header.
 *
 * @param store - The entity store, e.g. `context.Pool`
 * @param _entityName - Unused
 * @param id - Entity id to read
 * @returns The entity, or `undefined` when not found
 */
export function getRehydrated<E>(
  store: { get: (id: string) => Promise<E | undefined> },
  _entityName: TimestampEntityName,
  id: string,
): Promise<E | undefined> {
  return store.get(id);
}

/**
 * Runs a `getWhere` query: the same as `store.getWhere(filter)`, with a missing
 * result read as an empty list. See the file header.
 *
 * @param store - The entity store exposing `getWhere`, e.g. `context.Pool`
 * @param _entityName - Unused
 * @param filter - The `getWhere` filter, forwarded verbatim
 * @returns The matched entities
 */
export async function getWhereRehydrated<E, F>(
  store: { getWhere: (filter: F) => Promise<E[]> },
  _entityName: TimestampEntityName,
  filter: F,
): Promise<E[]> {
  return (await store.getWhere(filter)) ?? [];
}
