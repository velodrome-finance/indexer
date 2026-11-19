import { type EffectContext, type S, createEffect } from "envio";
import { type RpcResult, isCacheableResult } from "./RpcGateway";

/**
 * Options for {@link createRpcEffect}: envio's effect options minus
 * `rateLimit` (requests are rate-limited per chain at the transport, see
 * `RpcRateLimiter.ts`).
 */
export type RpcEffectOptions<I, O> = {
  name: string;
  input: S.Schema<I>;
  output: S.Schema<O>;
  cache: boolean;
  crossChain?: boolean;
};

/**
 * The only way to define an RPC-backed effect in this codebase.
 *
 * The handler must return an {@link RpcResult}, not a bare value, so it cannot
 * forget to say whether the value is a stand-in. The wrapper turns caching off
 * for this invocation (`context.cache = false`) unless the result is a real
 * answer or a deterministic-revert default, so a default produced by an RPC
 * outage is never persisted. Envio reads `context.cache` per invocation and an
 * inner effect's flag does not propagate to its caller, so an effect that
 * composes inner effects must fold their outcome into its own RpcResult.
 *
 * @param options - Effect name, schemas, cache flag and optional crossChain.
 * @param handler - Async function producing an RpcResult for an input.
 * @returns The envio effect.
 */
export function createRpcEffect<I, O>(
  options: RpcEffectOptions<I, O>,
  handler: (args: { input: I; context: EffectContext }) => Promise<
    RpcResult<O>
  >,
) {
  return createEffect(
    {
      name: options.name,
      input: options.input,
      output: options.output,
      rateLimit: false,
      cache: options.cache,
      ...(options.crossChain === undefined
        ? {}
        : { crossChain: options.crossChain }),
    },
    async ({ input, context }) => {
      const result = await handler({ input: input as I, context });
      if (!isCacheableResult(result)) {
        context.cache = false;
      }
      return result.value as O;
    },
  );
}
