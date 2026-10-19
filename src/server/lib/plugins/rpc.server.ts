/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's RPC methods, and the registry the HTTP route reads them from.
 *
 * Methods are held in a process-wide map keyed `pluginId\0method`, because the
 * route is reached over HTTP while the methods were registered by an in-process
 * load — the map is the seam between the two. The composite key is the
 * namespacing: a plugin registers `list` and the route resolves it as
 * `<pluginId>\0list`, so two plugins both having a `list` is not a collision.
 *
 * Validation runs through the Standard Schema subset the contract declares, not
 * through a library. That is deliberate: the chamber validates whatever the
 * plugin supplied, and the plugin may supply Zod, Valibot, ArkType or a plain
 * object with a `~standard.validate`. The SDK therefore ships no validator,
 * which is what keeps its dependency list empty.
 */

import type {
  PluginRpcError,
  PluginRpcMethod,
  PluginSchema,
  PluginSchemaIssue,
} from '@kabmo-labs/plugin-sdk';

/** A registered method, with the plugin it belongs to already resolved. */
export interface RegisteredRpcMethod {
  pluginId: string;
  method: string;
  definition: PluginRpcMethod<never, unknown>;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompChamberPluginRpc: Map<string, RegisteredRpcMethod> | undefined;
}

const key = (pluginId: string, method: string) => `${pluginId}\u0000${method}`;

function registry(): Map<string, RegisteredRpcMethod> {
  return (globalThis.__ompChamberPluginRpc ??= new Map());
}

/** Whether a name is a legal RPC method id. */
const METHOD_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Register one method for one plugin.
 *
 * Refuses a duplicate rather than replacing it: a plugin that registers `list`
 * twice has a bug, and a silent overwrite would make the second definition
 * unreachable with nothing on screen to say so.
 */
export function registerRpcMethod(pluginId: string, method: string, definition: PluginRpcMethod<never, unknown>): () => void {
  if (!METHOD_RE.test(method)) throw new Error(`"${method}" is not a valid RPC method name`);
  if (typeof definition?.handler !== 'function') throw new Error(`RPC method "${method}" has no handler`);
  const map = registry();
  const composite = key(pluginId, method);
  if (map.has(composite)) throw new Error(`RPC method "${method}" is already registered by this plugin`);
  map.set(composite, { pluginId, method, definition });
  return () => {
    map.delete(composite);
  };
}

/** Drop every method a plugin registered — called from its disposal pass. */
export function clearPluginRpcMethods(pluginId: string): void {
  const map = registry();
  for (const [composite, entry] of map) {
    if (entry.pluginId === pluginId) map.delete(composite);
  }
}

/** Whether a plugin has any methods registered, so the route can 404 early. */
export function hasRpcMethods(pluginId: string): boolean {
  for (const entry of registry().values()) {
    if (entry.pluginId === pluginId) return true;
  }
  return false;
}

/**
 * Run a schema's validator.
 *
 * `validate` may answer synchronously or with a promise — the interface allows
 * both because Zod 4's is sync while an async refinement is not — so this
 * awaits rather than assuming.
 */
async function runSchema(
  schema: PluginSchema,
  value: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; issues: readonly PluginSchemaIssue[] }> {
  const result = await schema['~standard'].validate(value);
  return 'value' in result ? { ok: true, value: result.value } : { ok: false, issues: result.issues };
}

/**
 * Call one method.
 *
 * Every failure is a VALUE, never a throw: the route turns it into a status
 * code, and a plugin's own exception must not escape into the server's request
 * handling as an unhandled rejection.
 */
export async function callRpcMethod(
  pluginId: string,
  method: string,
  input: unknown,
  context: { url: string; signal: AbortSignal },
): Promise<{ ok: true; value: unknown } | { ok: false; error: PluginRpcError }> {
  const entry = registry().get(key(pluginId, method));
  if (!entry) return { ok: false, error: { code: 'unknown_method', message: `no RPC method "${method}"` } };

  let args = input;
  if (entry.definition.input) {
    const checked = await runSchema(entry.definition.input, input);
    if (!checked.ok) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: 'the arguments did not match the method\'s schema', issues: checked.issues },
      };
    }
    args = checked.value;
  }

  let result: unknown;
  try {
    // The stored definition is typed `PluginRpcMethod<never, unknown>` so ANY
    // handler is assignable at the plugin's own call site (a `never` parameter
    // accepts every narrower one). That variance is exactly what makes it
    // uncallable here with a real argument, so the handler is invoked through
    // its runtime shape — the input was validated against the declared schema
    // immediately above, which is the only place the type could be established.
    const handler = entry.definition.handler as unknown as (
      input: unknown,
      context: { pluginId: string; url: string; signal: AbortSignal },
    ) => unknown;
    result = await handler(args, {
      pluginId,
      url: context.url,
      signal: context.signal,
    });
  } catch (error) {
    return {
      ok: false,
      error: { code: 'handler_error', message: error instanceof Error ? error.message : String(error) },
    };
  }

  if (entry.definition.output) {
    const checked = await runSchema(entry.definition.output, result);
    if (!checked.ok) {
      return {
        ok: false,
        error: {
          code: 'invalid_output',
          message: 'the handler answered a value that does not match its declared output schema',
          issues: checked.issues,
        },
      };
    }
    result = checked.value;
  }

  // A result JSON cannot carry is reported as a schema failure rather than
  // serialized as `undefined` — the caller would otherwise receive a 200 with
  // an empty body and no way to tell it from a method that answered nothing.
  if (JSON.stringify(result) === undefined) {
    return { ok: false, error: { code: 'invalid_output', message: 'the handler answered a value JSON cannot carry' } };
  }

  return { ok: true, value: result };
}

/** Test seam: forget every registration. */
export function resetPluginRpc(): void {
  registry().clear();
}
