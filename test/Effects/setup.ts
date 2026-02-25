/**
 * Shared test setup for Effects tests. Use when building mock context for
 * effect handlers (effect + log) to avoid duplicating the same pattern.
 */

export type MockEffect = {
  name: string;
  handler: (args: { input: unknown; context: unknown }) => unknown;
};

export type MockEffectContext = {
  effect: (effect: MockEffect, input: unknown) => unknown;
  log: {
    error: (msg: string, err: Error) => void;
    warn: (msg: string) => void;
  };
  cache?: boolean;
};

/**
 * Creates a mock context suitable for invoking effect handlers in tests.
 * The context's effect() calls the effect's handler with { input, context }.
 */
export function createMockEffectContext(): MockEffectContext {
  const mockContext = {} as MockEffectContext;
  mockContext.log = {
    error: vi.fn(),
    warn: vi.fn(),
  };
  mockContext.cache = true;
  mockContext.effect = (effect: MockEffect, input: unknown) =>
    effect.handler({ input, context: mockContext });
  return mockContext;
}
