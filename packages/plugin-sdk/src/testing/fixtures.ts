/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic inputs for a plugin test.
 *
 * Every fixture answers one question — what does the host hand a plugin — with
 * a value a test can assert on with no chamber, no database and no network.
 * They are plain data plus one in-memory store on purpose: a fake that reached
 * for the real host would test the host, not the plugin.
 *
 * `makeUiKitServices` is the important one. The kit reads its services from a
 * module-level slot (`configureUiKit`), so this object is installed through the
 * SAME function the app calls at boot — a harness that mocked the global
 * instead would exercise a seam no host has.
 */

import type {
  ComposerState,
  PanelContext,
  PanelHostProps,
  PluginRpcError,
  PluginRpcOutcome,
  UiKitServices,
} from '@ompchamber/ui';

/** The session and workspace a fixture answers with when a test names none. */
const DEFAULT_CONTEXT: PanelContext = { sessionId: 'session-1', workspacePath: '/workspace', theme: 'paper' };

/** A panel context a test can read back, or change and re-read. */
export function makePanelContext(overrides: Partial<PanelContext> = {}): PanelContext {
  return { ...DEFAULT_CONTEXT, ...overrides };
}

/** The props a panel body is rendered with: live, enabled, on its first read. */
export function makePanelHostProps(overrides: Partial<PanelHostProps> = {}): PanelHostProps {
  return {
    sessionId: DEFAULT_CONTEXT.sessionId,
    rootPath: DEFAULT_CONTEXT.workspacePath ?? undefined,
    enabled: true,
    active: true,
    refreshKey: 0,
    ...overrides,
  };
}

/**
 * The per-session store behind the fake kit.
 *
 * The string slot and the JSON slot are SEPARATE maps, exactly as the host
 * namespaces them (`plugin.<key>` for strings, `<key>` for JSON), so a test
 * cannot pass by reading the other slot's value.
 */
interface SessionSlots {
  get(sessionId: string | null, key: string): string | null;
  set(sessionId: string | null, key: string, value: string): void;
  subscribe(sessionId: string | null, key: string, listener: () => void): () => void;
  getJson<T>(sessionId: string | null, key: string): T | undefined;
  setJson(sessionId: string | null, key: string, value: unknown): void;
  subscribeJson(sessionId: string | null, key: string, listener: () => void): () => void;
}

function createSessionSlots(): SessionSlots {
  const strings = new Map<string, string>();
  const json = new Map<string, unknown>();
  const stringListeners = new Map<string, Set<() => void>>();
  const jsonListeners = new Map<string, Set<() => void>>();
  const slotKey = (sessionId: string | null, key: string) => `${sessionId ?? ''}\u0000${key}`;

  const subscribe = (bus: Map<string, Set<() => void>>, slot: string, listener: () => void) => {
    const bucket = bus.get(slot) ?? new Set<() => void>();
    bucket.add(listener);
    bus.set(slot, bucket);
    return () => bucket.delete(listener);
  };
  const notify = (bus: Map<string, Set<() => void>>, slot: string) => {
    for (const listener of [...(bus.get(slot) ?? [])]) listener();
  };

  return {
    get: (sessionId, key) => strings.get(slotKey(sessionId, key)) ?? null,
    set: (sessionId, key, value) => {
      const slot = slotKey(sessionId, key);
      strings.set(slot, value);
      notify(stringListeners, slot);
    },
    subscribe: (sessionId, key, listener) => subscribe(stringListeners, slotKey(sessionId, key), listener),
    // The JSON slot is untyped by design, exactly as the host's own store is:
    // whoever reads it names the shape it wrote, and the store holds whatever
    // that was. `useSessionState<T>` is the kit's end of the same contract.
    getJson: <T,>(sessionId: string | null, key: string) => json.get(slotKey(sessionId, key)) as T | undefined,
    setJson: (sessionId, key, value) => {
      const slot = slotKey(sessionId, key);
      json.set(slot, value);
      notify(jsonListeners, slot);
    },
    subscribeJson: (sessionId, key, listener) => subscribe(jsonListeners, slotKey(sessionId, key), listener),
  };
}

/** The session slots for the CURRENT context session, for assertions. */
export interface FakeSessionHandle {
  read(key: string): string | null;
  write(key: string, value: string): void;
  subscribe(key: string, listener: () => void): () => void;
  readJson<T>(key: string): T | undefined;
  writeJson(key: string, value: unknown): void;
}

export interface FakeUiKitOptions {
  /** The context the fake answers `context()` with. */
  context?: Partial<PanelContext>;
  /** Files `readWorkspaceFile` can answer, by workspace-relative path. */
  files?: Record<string, string>;
  /** The composer's starting state. */
  composer?: Partial<ComposerState>;
}

/**
 * The fake host services, plus the handles a test drives them with.
 *
 * It IS a `UiKitServices` — `configureUiKit` takes it directly — with the
 * controls the kit deliberately does not expose (move the context, read what a
 * plugin wrote, answer an RPC call) attached under names the service interface
 * does not use.
 */
export interface FakeUiKit extends UiKitServices {
  /** The context as it stands. */
  readonly currentContext: PanelContext;
  /** Move the context and wake every `usePanelInfo` reader. */
  setContext(next: Partial<PanelContext>): void;
  /** Files the fake `readWorkspaceFile` answers. */
  readonly files: Map<string, string>;
  /** The session slots for the current context session. */
  readonly session: FakeSessionHandle;
  /** Methods a test has stubbed, and the calls made to them. */
  readonly rpc: FakeRpcHandle;
  /** Push a value onto the plugin's topic, as `api.realtime.publish` would. */
  publishTopic(value: unknown): void;
  /**
   * The composer's live state and the writes a plugin made.
   *
   * Named `composerControl` because `composer` is the SERVICE the kit reads:
   * one name cannot be both the function the hook calls and the handle a test
   * asserts through.
   */
  readonly composerControl: FakeComposerHandle;
}

/** Stubbed RPC methods and the calls a test made against them. */
export interface FakeRpcHandle {
  /** Answer `method` with `value`. */
  stub(method: string, value: unknown): void;
  /** Answer `method` with a refusal, as the real route does at HTTP 200. */
  stubError(method: string, error: PluginRpcError): void;
  /** Every call made, in order — with the plugin the caller was scoped to. */
  readonly calls: { pluginId: string; method: string; input: unknown }[];
}

/** The composer's state, its writes, and what a plugin asked of it. */
export interface FakeComposerHandle {
  readonly state: ComposerState;
  setState(next: Partial<ComposerState>): void;
  /** The drafts a plugin set, in order. */
  readonly sets: string[];
  /** The insertions a plugin made, in order. */
  readonly inserts: string[];
  /** How many times a plugin asked for focus. */
  focusCount(): number;
}

/** A complete fake `UiKitServices` with an in-memory per-session store. */
export function makeUiKitServices(options: FakeUiKitOptions = {}): FakeUiKit {
  const slots = createSessionSlots();
  const files = new Map(Object.entries(options.files ?? {}));
  const contextListeners = new Set<(context: PanelContext) => void>();
  let context = makePanelContext(options.context);

  const session: FakeSessionHandle = {
    read: (key) => slots.get(context.sessionId, key),
    write: (key, value) => slots.set(context.sessionId, key, value),
    subscribe: (key, listener) => slots.subscribe(context.sessionId, key, listener),
    readJson: (key) => slots.getJson(context.sessionId, key),
    writeJson: (key, value) => slots.setJson(context.sessionId, key, value),
  };

  // --- the participant half -------------------------------------------------
  const answers = new Map<string, PluginRpcOutcome>();
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const topicListeners = new Set<(value: unknown) => void>();
  let topicValue: unknown;
  let topicStale = false;

  const composerSets: string[] = [];
  const composerInserts: string[] = [];
  let focusCount = 0;
  const composerListeners = new Set<(state: ComposerState) => void>();
  let composerState: ComposerState = {
    text: '',
    isEmpty: true,
    isSubmitting: false,
    scope: { kind: 'new', sessionId: null },
    ...options.composer,
  };

  const announceComposer = () => {
    for (const listener of [...composerListeners]) listener(composerState);
  };

  return {
    context: () => context,
    subscribe: (listener) => {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    },
    getSessionValue: (sessionId, key) => slots.get(sessionId, key),
    setSessionValue: (sessionId, key, value) => slots.set(sessionId, key, value),
    subscribeSessionValue: (sessionId, key, listener) => slots.subscribe(sessionId, key, listener),
    getSessionJson: (sessionId, key) => slots.getJson(sessionId, key),
    setSessionJson: (sessionId, key, value) => slots.setJson(sessionId, key, value),
    subscribeSessionJson: (sessionId, key, listener) => slots.subscribeJson(sessionId, key, listener),
    readWorkspaceFile: async (workspacePath, relativePath) => {
      if (!workspacePath) throw new Error('No workspace folder is active.');
      const content = files.get(relativePath);
      if (content === undefined) throw new Error(`No test file is configured at "${relativePath}".`);
      return content;
    },
    // The host injects the chamber's own renderer; the fake has none, and the
    // kit degrades to plain text rather than failing — which is what a plugin
    // test should see.
    markdown: () => null,

    // --- the participant services -------------------------------------------
    callRpc: async (_pluginId, method, input) => {
      calls.push({ pluginId: _pluginId, method, input });
      // An unstubbed method answers `unknown_method`, exactly as the route does
      // — a fake that resolved `undefined` would let a plugin ship a typo.
      return answers.get(method) ?? { ok: false, error: { code: 'unknown_method', message: `no stub for "${method}"` } };
    },
    subscribePluginTopic: (_pluginId, listener) => {
      topicListeners.add(listener);
      return () => topicListeners.delete(listener);
    },
    readPluginTopic: () => topicValue,
    refreshPluginTopic: () => {
      // A refresh in the fake is a re-announcement of the value on hand, which
      // is what a real one looks like to a subscriber that is already current.
      for (const listener of [...topicListeners]) listener(topicValue);
    },
    pluginTopicStale: () => topicStale,
    composer: () => ({
      ...composerState,
      set: (text: string) => {
        composerSets.push(text);
        composerState = { ...composerState, text, isEmpty: text.length === 0 };
        announceComposer();
      },
      insert: (text: string) => {
        composerInserts.push(text);
        const next = `${composerState.text}${text}`;
        composerState = { ...composerState, text: next, isEmpty: next.length === 0 };
        announceComposer();
      },
      focus: () => {
        focusCount += 1;
      },
    }),
    subscribeComposer: (listener) => {
      composerListeners.add(listener);
      return () => composerListeners.delete(listener);
    },

    get currentContext() {
      return context;
    },
    setContext: (next) => {
      context = { ...context, ...next };
      for (const listener of [...contextListeners]) listener(context);
    },
    files,
    session,
    rpc: {
      stub: (method, value) => answers.set(method, { ok: true, value }),
      stubError: (method, error) => answers.set(method, { ok: false, error }),
      calls,
    },
    publishTopic: (value) => {
      topicValue = value;
      for (const listener of [...topicListeners]) listener(value);
    },
    composerControl: {
      get state() {
        return composerState;
      },
      setState: (next) => {
        composerState = { ...composerState, ...next };
        announceComposer();
      },
      sets: composerSets,
      inserts: composerInserts,
      focusCount: () => focusCount,
    },
  };
}

/**
 * A JSON `Response`, for a test that drives `useChamberFetch`.
 *
 * The body is JSON-encoded rather than passed through, because that is what the
 * hook parses — a test that stubbed a raw string would never exercise the parse.
 * `init` still decides the status, so an error case is `{ status: 500 }` plus a
 * `{ error }` body.
 */
export function makeChamberFetchResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}
