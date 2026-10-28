/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scope watcher, driven through the kit's own service seam.
 *
 * The property under test is the one the panel CANNOT provide: the sweep runs
 * while no panel is mounted. That is why the watcher is a content script at all,
 * and it is invisible to a component test — there is no component.
 *
 * Three behaviours, each a bug shape if dropped:
 *
 * - **It sweeps on every notification, not only on a change.** `stop-others` is
 *   defined by the scope it is handed, so an idempotent call is the design; a
 *   watcher that compared against a remembered scope would go permanently silent
 *   after one missed notification.
 * - **It uses the SERVICES, not the hooks.** A content script is not a Preact
 *   component, so `useRepoScope()` would throw — the plugin id it needs comes
 *   from its own mount argument.
 * - **A refusal is reported.** A sweep that never ran is a process the user
 *   believes is stopped.
 *
 * The kit's services are installed with `configureUiKit` and a fake `callRpc`, so
 * no socket and no server are involved.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { configureUiKit, type RepoScope, type UiKitServices } from '@kabmo-labs/kabmo-ui';
import type { ContentScriptContext } from '@kabmo-labs/kabmo-sdk';

import { mountScopeWatch, stopOtherScopes } from './watch';

/** One recorded RPC call. */
interface Call {
  pluginId: string;
  method: string;
  input: unknown;
}

let calls: Call[];
/** What `callRpc` answers with. */
let outcome: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
/** The scope the service reports. */
let scope: RepoScope;
/** The session the context reports. */
let sessionId: string | null;
/** The listeners `subscribeRepoScope` registered. */
let listeners: Array<() => void>;
/** Console errors the watcher emitted. */
let errors: string[];

const nativeGlobals: Partial<Record<'window' | 'document', unknown>> = {};
/** The runner's own `console.error`, captured once so it is restored exactly. */
const nativeConsoleError = console.error;

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of ['window', 'document'] as const) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }

  calls = [];
  errors = [];
  listeners = [];
  sessionId = 's1';
  outcome = { ok: true, value: { stopped: 0 } };
  scope = {
    root: '/ws',
    repo: 'projects/alpha',
    rows: [
      { repo: '.', label: 'ws', short: 'ws' },
      { repo: 'projects/alpha', label: 'projects/alpha', short: 'alpha' },
    ],
    scanning: false,
    ready: true,
  };

  const services: UiKitServices = {
    context: () => ({ sessionId, workspacePath: scope.root, theme: 'paper' }),
    subscribe: () => () => {},
    getSessionValue: () => null,
    setSessionValue: () => {},
    readWorkspaceFile: async () => '',
    repoScope: () => scope,
    setRepoScope: () => {},
    subscribeRepoScope: (listener) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((entry) => entry !== listener);
      };
    },
    rescanRepoScope: () => {},
    callRpc: async (pluginId, method, input) => {
      calls.push({ pluginId, method, input });
      return outcome;
    },
  };
  configureUiKit(services);

  // The watcher reports a refusal through the console; capture it rather than
  // letting a test's output carry an expected error.
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.error = nativeConsoleError;
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of ['window', 'document'] as const) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

/** The mount context a content script is handed. */
function context(): ContentScriptContext {
  const win = globalThis as unknown as { document: Document };
  const root = win.document.createElement('div');
  root.setAttribute('data-plugin-surface', 'command-runner');
  return { pluginId: 'command-runner', root, generation: 1, signal: new AbortController().signal };
}

describe('stopOtherScopes', () => {
  test('asks the server for the scope it was given, under the plugin id it was given', async () => {
    await stopOtherScopes('command-runner', { root: '/ws', repo: 'projects/alpha' }, 's1');

    expect(calls).toHaveLength(1);
    expect(calls[0].pluginId).toBe('command-runner');
    expect(calls[0].method).toBe('stop-others');
    expect(calls[0].input).toEqual({ root: '/ws', repo: 'projects/alpha', sessionId: 's1' });
  });

  test('a refusal is reported, not swallowed', async () => {
    outcome = { ok: false, error: { code: 'no_plugin', message: 'no plugin is loaded' } };
    await stopOtherScopes('command-runner', { root: '/ws', repo: '.' }, null);

    expect(errors.some((line) => line.includes('stop-others refused'))).toBe(true);
  });
});

describe('mountScopeWatch', () => {
  test('sweeps once at mount, before anything changes', async () => {
    // The property a panel cannot provide: this runs with no panel mounted.
    const dispose = mountScopeWatch(context());
    // The call is async; let its microtask land.
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({ root: '/ws', repo: 'projects/alpha', sessionId: 's1' });
    dispose();
  });

  test('sweeps again on every notification, change or not', async () => {
    const dispose = mountScopeWatch(context());
    await Promise.resolve();

    // Three notifications, including two with an unchanged scope: the call is
    // defined by the scope it carries, so repeating it is a no-op server-side
    // and a missed notification cannot silence the watcher for good.
    for (const _ of [1, 2, 3]) {
      for (const listener of listeners) listener();
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.length).toBe(4);
    dispose();
  });

  test('follows the session, because the slot is per-session', async () => {
    const dispose = mountScopeWatch(context());
    await Promise.resolve();

    sessionId = 's2';
    for (const listener of listeners) listener();
    await Promise.resolve();

    // The session travels with the call, so the server scopes its sweep to the
    // right session's runs.
    expect(calls.at(-1)?.input).toEqual({ root: '/ws', repo: 'projects/alpha', sessionId: 's2' });
    dispose();
  });

  test('the disposer drops the subscription, so a disabled plugin stops sweeping', async () => {
    const dispose = mountScopeWatch(context());
    await Promise.resolve();
    expect(listeners).toHaveLength(1);

    dispose();
    expect(listeners).toHaveLength(0);

    const before = calls.length;
    // Nothing left to notify: a leaked listener would fire against a plugin the
    // host has already torn down.
    expect(calls.length).toBe(before);
  });

  test('a host without the repo scope is not an error', async () => {
    const services = {
      context: () => ({ sessionId: 's1', workspacePath: '/ws', theme: 'paper' }),
      subscribe: () => () => {},
      getSessionValue: () => null,
      setSessionValue: () => {},
      readWorkspaceFile: async () => '',
      // No repoScope / subscribeRepoScope: an older host.
    } as UiKitServices;
    configureUiKit(services);

    const dispose = mountScopeWatch(context());
    await Promise.resolve();

    // Nothing to watch, and nothing thrown — the panel's own sweep is the net.
    expect(calls).toHaveLength(0);
    dispose();
  });

  test('a scope with no root sweeps nothing', async () => {
    scope = { root: null, repo: '.', rows: [], scanning: false, ready: false };
    const dispose = mountScopeWatch(context());
    await Promise.resolve();

    // `root: ''`/null would resolve against the SERVER's cwd, so the watcher
    // refuses to send it rather than sweeping the wrong tree.
    expect(calls).toHaveLength(0);
    dispose();
  });
});
