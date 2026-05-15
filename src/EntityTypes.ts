// Re-export of GraphQL entity types whose names collide with contract namespaces
// in the `generated` barrel. After renaming the entities to `Pool`/`PoolSnapshot`
// (issue #709), the top-level `Pool` value re-export from the V2 Pool contract
// shadows the `Pool` type re-export at the package boundary — TypeScript's
// `export type *` does not merge with a sibling value-only re-export of the
// same name. Importing the types directly from `generated/src/Types` sidesteps
// that, so this module exists as the single project-side path for those types.
export type { Pool, PoolSnapshot } from "../generated/src/Types";
