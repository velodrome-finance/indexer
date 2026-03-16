/**
 * Event handler registration for tests that use processEvents().
 *
 * In envio alpha.18+, processEvents() auto-loads handlers via registerAllHandlers()
 * which uses autoLoadFromSrcHandlers (tsx ESM loader). Static handler imports here
 * are no longer needed and would cause double-registration (handlers composed 2x).
 *
 * This file is kept as an empty module since test files import it.
 * Handler loading is fully managed by processEvents() at runtime.
 */
