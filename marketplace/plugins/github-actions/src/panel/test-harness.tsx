/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness both panel suites mount through: a real DOM, the kit configured
 * with the host's own services faked, and the one container the panel renders
 * into.
 *
 * It is a module with MUTABLE state rather than a factory because a suite has to
 * change an answer between the mount and the click — `harness.listOutcome = …` —
 * and every file gets its own copy: `bun test` runs each suite in its own module
 * graph.
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  PanelHostProvider,
  PluginIdProvider,
  configureUiKit,
  type RepoScope,
  type UiKitServices,
} from '@kabmo-labs/kabmo-ui';

import type { RunDetail, RunPage } from '../protocol';
import { ActionsPanel } from './index';
import { detail, page } from './test-fixtures';

export type RpcOutcome<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

export const harness = {
  container: null as HTMLElement | null,
  calls: [] as Array<{ method: string; input: unknown }>,
  listOutcome: null as RpcOutcome<RunPage> | null,
  runOutcome: null as RpcOutcome<RunDetail> | null,
  logOutcome: null as RpcOutcome<unknown> | null,
  scope: null as RepoScope | null,
  /** Every repository written to the shared slot, oldest first. */
  picks: [] as string[],
  scopeListeners: new Set<() => void>(),
};

/** happy-dom's globals, installed once per file and restored afterwards. */
export function installDom(): void {
  const win = new Window({ url: 'http://localhost/' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!saved.has(key)) saved.set(key, target[key]);
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
}

export function restoreDom(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (saved.has(key)) target[key] = saved.get(key);
    else delete target[key];
  }
}

/** A fresh scope, answers and container for one test. */
export function resetHarness(): void {
  harness.calls = [];
  harness.listOutcome = { ok: true, value: page() };
  harness.runOutcome = { ok: true, value: detail() };
  harness.logOutcome = {
    ok: false,
    error: { code: 'handler_error', message: 'Job logs need a token: GitHub answers 403 to an anonymous read.' },
  };
  harness.scope = {
    root: '/ws',
    repo: 'projects/alpha',
    rows: [
      { repo: '.', label: 'ws', short: 'ws' },
      { repo: 'projects/alpha', label: 'projects/alpha', short: 'alpha' },
    ],
    scanning: false,
    ready: true,
  };
  harness.picks = [];
  harness.scopeListeners = new Set();

  const services: UiKitServices = {
    context: () => ({ sessionId: 's1', workspacePath: '/ws', theme: 'paper' }),
    subscribe: () => () => {},
    getSessionValue: () => null,
    setSessionValue: () => {},
    readWorkspaceFile: async () => '',
    repoScope: () => harness.scope as RepoScope,
    setRepoScope: (repo) => {
      harness.picks.push(repo);
      // The host resolves the row and re-publishes; a fake that only recorded
      // the call would leave the trigger showing the old pick.
      const current = harness.scope as RepoScope;
      const row = current.rows.find((entry) => entry.repo === repo);
      harness.scope = { ...current, repo, ready: true };
      if (!row) return;
      for (const listener of harness.scopeListeners) listener();
    },
    subscribeRepoScope: (listener) => {
      harness.scopeListeners.add(listener);
      return () => harness.scopeListeners.delete(listener);
    },
    rescanRepoScope: () => {},
    callRpc: async (_pluginId, method, input) => {
      harness.calls.push({ method, input });
      if (method === 'run') return harness.runOutcome as RpcOutcome<RunDetail>;
      if (method === 'log') return harness.logOutcome as RpcOutcome<unknown>;
      if (method === 'act') return { ok: true, value: { message: 'Cancellation requested.' } };
      return harness.listOutcome as RpcOutcome<RunPage>;
    },
  };
  configureUiKit(services);

  harness.container = document.createElement('div');
  document.body.appendChild(harness.container);
}

export function teardownHarness(): void {
  const container = harness.container;
  if (container) {
    render(null, container);
    container.remove();
    harness.container = null;
  }
}

export async function mount(): Promise<void> {
  const container = harness.container as HTMLElement;
  await act(async () => {
    render(
      h(PanelHostProvider, {
        value: { sessionId: 's1', enabled: true, active: true, refreshKey: 0 },
        children: h(PluginIdProvider, {
          pluginId: 'github-actions',
          children: h(ActionsPanel, {}),
        }),
      }),
      container,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

export function click(element: Element | null | undefined): void {
  element?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

/**
 * A click and the render it causes.
 *
 * `act` is not ceremony here: a handler's state update is applied by Preact's
 * scheduler, so a bare `dispatchEvent` followed by an assertion reads the DOM
 * BEFORE the click landed and the suite passes on a panel that never updated.
 */
export async function clickAndSettle(element: Element | null | undefined): Promise<void> {
  await act(async () => {
    click(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

export function row(id: number): Element | null {
  return (harness.container as HTMLElement).querySelector(`[data-action-row="${id}"]`);
}
