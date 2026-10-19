/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The server-side contract: what a plugin's `server.ts` receives.
 *
 * A plugin with a server half is a module Kabmo's process imports, not
 * the page. That is the same trust decision the bundle already carries (a
 * plugin runs with full access to the app it was installed into) — what this
 * file adds is the SHAPE of the access, and the shape is what makes one plugin
 * unable to reach another's state: every member is bound to the plugin's own
 * id by the host before it is handed over, so a plugin is never given a string
 * it could point at somebody else.
 *
 * Types only. The runtime half lives in Kabmo
 * (`src/server/lib/plugins/`), because a published package cannot import the
 * host's own source — the same seam `@kabmo-labs/kabmo-ui` uses.
 *
 * Every member is OPTIONAL except `pluginId`. A host that implements a subset
 * hands over that subset, and a plugin that asks for the rest is refused at
 * load with a reason rather than crashing mid-operation — which is also what
 * lets the contract grow without breaking the plugins already written against
 * it.
 */

/**
 * A validator-neutral schema, the subset of Standard Schema v1 this contract
 * uses for RPC arguments and results.
 *
 * Deliberately the INTERFACE and not a library: Zod 4, Valibot and ArkType all
 * satisfy it, and a plugin that wants none of them can return a plain object
 * with a `~standard.validate`. The Kabmo validates through this shape, so the
 * SDK needs no validator of its own — which is what keeps its dependency list
 * empty.
 *
 * NOT generic over its output, and that is deliberate. A registry has to store
 * methods of every schema type together, and a covariant output parameter makes
 * that storage unsound: `PluginSchema<string>` is not assignable to
 * `PluginSchema<unknown>` when the parameter is used in a position the registry
 * has to accept. Erasing it here is what lets the handler's own `In`/`Out`
 * carry the types a plugin author cares about.
 */
export interface PluginSchemaIssue {
  message: string;
  path?: readonly (string | number)[];
}

export type PluginSchemaResult =
  | { readonly value: unknown }
  | { readonly issues: readonly PluginSchemaIssue[] };

export interface PluginSchema {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => PluginSchemaResult | Promise<PluginSchemaResult>;
  };
}

/** Stable wire error categories for a plugin RPC call. */
export type PluginRpcErrorCode =
  | 'invalid_json'
  | 'invalid_input'
  | 'handler_error'
  | 'invalid_output'
  | 'unknown_method';

/** A structured RPC failure. Returned as `{ ok: false, error }`, never thrown. */
export interface PluginRpcError {
  code: PluginRpcErrorCode;
  message: string;
  issues?: readonly PluginSchemaIssue[];
}

/** What one RPC method answers. */
export type PluginRpcResult<T> = { ok: true; value: T } | { ok: false; error: PluginRpcError };

/**
 * One RPC method.
 *
 * `input`/`output` are optional: a method with no schema accepts anything
 * JSON-shaped and answers whatever the handler returned, which is the honest
 * contract for a plugin whose arguments are already narrow. When `output` is
 * given the result is validated too — a method that promises a shape and
 * returns another is a bug the caller would otherwise meet as a runtime error
 * in its own code.
 *
 * `In` is the handler's parameter type. The Kabmo validates the actual
 * argument against the schema; the type is the plugin author's own description
 * of what the schema admits, which is why it is stated here rather than derived.
 */
export interface PluginRpcMethod<In = unknown, Out = unknown> {
  input?: PluginSchema;
  output?: PluginSchema;
  handler: (input: In, context: PluginRpcContext) => Out | Promise<Out>;
}

/** Per-call context: who asked, and for what. */
export interface PluginRpcContext {
  /** The plugin the method belongs to. Never another plugin's id. */
  readonly pluginId: string;
  /** The request's URL, for a method that branches on a query parameter. */
  readonly url: string;
  /** Aborts when the caller disconnects. */
  readonly signal: AbortSignal;
}

/**
 * The RPC registrar. Method names are namespaced by the host, not the plugin.
 *
 * Generic in `In`/`Out` so the handler's parameter and return types are
 * INFERRED from what the plugin writes: `register('save', { handler: ({ id }) => … })`
 * gives `id` a type without the author restating it. The registry stores the
 * erased form (see `PluginRpcMethod`), which is what lets methods of different
 * shapes live in one map.
 */
export interface PluginRpcApi {
  register<In = unknown, Out = unknown>(method: string, definition: PluginRpcMethod<In, Out>): () => void;
}

/**
 * A JSON value, as the wire carries it.
 *
 * Declared rather than `unknown` so a plugin's handler is checked against what
 * can actually cross the boundary — a `Map`, a `Date` or a class instance
 * reaching the response is a serialization bug, and the type is the cheapest
 * place to catch it.
 */
export type PluginJson =
  | string
  | number
  | boolean
  | null
  | PluginJson[]
  | { [key: string]: PluginJson };

/**
 * Namespaced key/value storage.
 *
 * Every key is stored under the plugin's own id, so two plugins cannot collide
 * even on the same key name. `read` answers `undefined` for a key never
 * written, which is distinct from one written as `null`.
 */
export interface PluginKvStorage {
  read<T = PluginJson>(key: string): Promise<T | undefined>;
  write(key: string, value: PluginJson): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every key this plugin owns, sorted. */
  keys(): Promise<string[]>;
}

/**
 * Namespaced record storage: rows with an id, for anything a key/value map
 * cannot express (a list that is queried, an item that is updated in place).
 *
 * The host owns the table and the id column; the plugin owns the `data` blob
 * and the optional `collection` grouping. That is the whole contract — a plugin
 * does not get to declare its own schema, because a table name is a global
 * namespace and two plugins choosing `notes` must not collide.
 */
export interface PluginRecordStorage {
  put(collection: string, id: string, data: PluginJson): Promise<void>;
  get<T = PluginJson>(collection: string, id: string): Promise<T | undefined>;
  list<T = PluginJson>(collection: string, options?: { limit?: number }): Promise<Array<{ id: string; data: T }>>;
  remove(collection: string, id: string): Promise<void>;
  clear(collection: string): Promise<void>;
}

export interface PluginStorageApi {
  readonly kv: PluginKvStorage;
  readonly records: PluginRecordStorage;
}

/**
 * One declared setting, from the plugin's manifest.
 *
 * Declarative so the host can render a form and validate a value without the
 * plugin running: a plugin that is switched off still shows its settings, and
 * a value written by hand in the database is still checked against the same
 * rule the plugin declared.
 */
export interface PluginSettingDefinition {
  /** `string` is the only editor the host renders today; the rest are refused. */
  type: 'string' | 'number' | 'boolean';
  label: string;
  description?: string;
  default?: string | number | boolean;
  /** A secret is stored, never returned to the client — only its presence is. */
  secret?: boolean;
}

export interface PluginSettingsApi {
  /** The values as they stand, defaults filled in for keys never written. */
  read(): Promise<Record<string, string | number | boolean>>;
  readOne<T extends string | number | boolean>(key: string): Promise<T | undefined>;
  write(key: string, value: string | number | boolean): Promise<void>;
  /** Subscribe to writes, so a running plugin can react without a restart. */
  subscribe(listener: (values: Record<string, string | number | boolean>) => void): () => void;
}

/**
 * A named lifecycle announcement.
 *
 * Additive by contract: the host announces what it has, and a plugin that
 * listens for something it never receives is a plugin written against a newer
 * host — which the `engines` range is what catches, not this interface.
 */
export interface PluginEventsApi {
  on<T = PluginJson>(name: string, listener: (payload: T) => void): () => void;
  /** Announce an event to the other plugins and the client. */
  emit(name: string, payload?: PluginJson): void;
}

/**
 * Push to connected clients.
 *
 * A plugin publishes a VALUE for its own topic; the host owns delivery, the
 * sequence numbering and the snapshot-on-subscribe behaviour, exactly as it
 * does for every built-in topic. A plugin therefore cannot invent a frame the
 * client does not understand.
 */
export interface PluginRealtimeApi {
  /** Publish the plugin's topic value to every subscriber. */
  publish(payload: PluginJson): void;
  /** The value as it currently stands (what a new subscriber receives). */
  current(): PluginJson | undefined;
  /** Set the value WITHOUT notifying — the seed for `publish`. */
  seed(payload: PluginJson): void;
}

/**
 * Long-lived work.
 *
 * `service` is a start/stop pair the host runs once and disposes on reload;
 * `schedule` is a cron expression or interval spec handled by Kabmo's own
 * scheduler, so a plugin's timer survives a restart exactly the way a scheduled
 * task does. Both are declared, never run by the plugin itself: a plugin that
 * owned its own timer would leak one on every reload.
 */
export interface PluginBackgroundApi {
  service(id: string, service: { start: () => void | Promise<void>; stop?: () => void | Promise<void> }): void;
  schedule(id: string, spec: string, run: () => void | Promise<void>): void;
}

/** A leveled logger, prefixed with the plugin's id so a log line says whose it is. */
export interface PluginLogger {
  debug(message: string, detail?: PluginJson): void;
  info(message: string, detail?: PluginJson): void;
  warn(message: string, detail?: PluginJson): void;
  error(message: string, detail?: PluginJson): void;
}

/**
 * A plugin's own HTTP surface, under `/api/plugins/<id>/http/*`.
 *
 * Separate from `rpc` because the two answer different callers: `rpc` is a
 * named method the plugin's OWN client half calls, while `http` is a REST
 * surface a plugin may want for anything else — a webhook receiver, a
 * shareable URL, a stream. The handler is a plain `Request → Response`
 * function, the same shape a route module's loader is, so a plugin author
 * writes what they already know.
 *
 * A path is matched EXACTLY (after the plugin's own prefix), so `/status` and
 * `/status/detail` are two registrations rather than one prefix rule that could
 * swallow a path the plugin never declared.
 */
export interface PluginHttpApi {
  /**
   * Register one path. `path` is relative to the plugin's own prefix and must
   * start with `/`. A second registration for the same path is refused.
   */
  route(path: string, handler: (request: Request) => Response | Promise<Response>): () => void;
}

/**
 * The API a plugin's `server.ts` receives.
 *
 * The default export is a factory — `export default function plugin(api) {}` —
 * so the host controls WHEN a plugin runs and can hand it a subset. An
 * exported object would be evaluated at import time, which is exactly what the
 * host must be able to defer and to refuse.
 */
export interface KabmoPluginApi {
  /** The plugin's own id. Namespaces every other member. */
  readonly pluginId: string;
  readonly log: PluginLogger;
  readonly storage: PluginStorageApi;
  readonly settings: PluginSettingsApi;
  readonly rpc: PluginRpcApi;
  readonly http: PluginHttpApi;
  readonly realtime: PluginRealtimeApi;
  readonly events: PluginEventsApi;
  readonly background: PluginBackgroundApi;
  /**
   * Register cleanup, run on reload, disable and removal.
   *
   * LIFO, and exactly once per registration. The sanctioned place to clear a
   * timer, close a connection or unsubscribe — a plugin that keeps one in a
   * module-level variable leaks it on the next reload.
   */
  onDispose(hook: () => void | Promise<void>): void;
}

/** A plugin's server entry: the default export of its `server.ts`. */
export type KabmoPluginFactory = (api: KabmoPluginApi) => void | Promise<void>;

/**
 * @deprecated Use `KabmoPluginApi`. Kept as an alias because a plugin's own
 * source names this type in its `server.ts` signature, and renaming it would
 * break every published plugin at compile time for a cosmetic change.
 */
export type ChamberPluginApi = KabmoPluginApi;

/** @deprecated Use `KabmoPluginFactory`. */
export type ChamberPluginFactory = KabmoPluginFactory;

/** Whether a loaded module's default export is a server entry. */
export function isPluginServerFactory(value: unknown): value is KabmoPluginFactory {
  return typeof value === 'function';
}
