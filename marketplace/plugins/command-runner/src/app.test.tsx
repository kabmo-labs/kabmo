/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The assembled panel's Rescan, mounted the way the host mounts it.
 *
 * The panel draws two reads that answer different questions — the SCAN (an RPC
 * that reads the repository's command files) and the RUN LIST (the plugin's own
 * realtime topic). The header's Rescan used to move only the scan, so a reader
 * who pressed it to check on a background job got a fresh file list and the same
 * stale runs: a job that had finished still read `running`, and the one control
 * for "ask again" answered a different question than the one asked.
 *
 * The property pinned here is that one press asks BOTH, and that it does so
 * through the topic's own resync rather than by inventing a second read.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { loadPluginApp, uninstallTestPluginRuntime } from '@kabmo-labs/kabmo-sdk/testing/app';
import {
  PanelHostProvider,
  PluginIdProvider,
  configureUiKit,
  uiKitServices,
  type RepoScope,
  type UiKitServices,
} from '@kabmo-labs/kabmo-ui';

import pluginDefinition from './app';
import type { CommandListing, RunnerState } from './protocol';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

beforeAll(() => {
  const win = new Window({ url: 'http://localhost/' });
  for (const key of DOM_GLOBALS) {
    saved.set(key, Reflect.get(globalThis, key));
    Reflect.set(globalThis, key, (win as unknown as Record<string, unknown>)[key]);
  }
});

afterEach(() => {
  uninstallTestPluginRuntime();
});

afterAll(() => {
  for (const key of DOM_GLOBALS) Reflect.set(globalThis, key, saved.get(key));
});

/** The id `loadPluginApp` registers under by default. */
const PLUGIN_ID = 'plugin-under-test';

const SCOPE: RepoScope = {
  root: '/ws',
  repo: '.',
  rows: [{ repo: '.', label: 'ws', short: 'ws' }],
  scanning: false,
  ready: true,
};

const LISTING: CommandListing = {
  groups: [
    {
      file: 'package.json',
      cwd: '.',
      kind: 'package',
      runner: 'bun',
      commands: [{ id: 'package.json#package:dev', name: 'dev', label: 'bun run dev', argv: ['bun', 'run', 'dev'] }],
    },
  ],
  truncated: false,
  empty: [],
  sources: ['package.json', 'Makefile'],
};

const STATE: RunnerState = {
  scopeKey: '/ws\u0000.',
  runs: [
    {
      id: 'run-1',
      sessionId: 's1',
      scopeKey: '/ws\u0000.',
      commandId: 'package.json#package:dev',
      file: 'package.json',
      label: 'bun run dev',
      background: true,
      status: 'exited',
      startedAt: Date.now() - 1_000,
      endedAt: Date.now(),
      exitCode: 0,
      signal: null,
      bytes: 3,
      ringBytes: 3,
    },
  ],
};

describe('CommandRunnerPanel refresh', () => {
  test('Rescan re-reads the command files AND asks the run topic for its snapshot', async () => {
    const { harness } = loadPluginApp(pluginDefinition);
    harness.services.rpc.stub('list', LISTING);
    harness.services.publishTopic(STATE);
    let topicRefreshes = 0;
    const services: UiKitServices = {
      ...harness.services,
      repoScope: () => SCOPE,
      subscribeRepoScope: () => () => {},
      refreshPluginTopic: () => {
        topicRefreshes += 1;
      },
    };
    configureUiKit(services);

    const registration = harness.registrations.rightPanel;
    if (!registration) throw new Error('the plugin registered no right panel');

    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(
        h(PanelHostProvider, {
          value: { sessionId: 's1', enabled: true, active: true, refreshKey: 0, rootPath: '/ws' },
          children: h(PluginIdProvider, {
            pluginId: PLUGIN_ID,
            children: h(registration.component, { sessionId: 's1', workspacePath: '/ws' }),
          }),
        }),
        container,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const listsBefore = harness.services.rpc.calls.filter((call) => call.method === 'list').length;
    expect(listsBefore).toBeGreaterThan(0);

    const rescan = container.querySelector<HTMLButtonElement>('button[aria-label="Rescan this repository"]');
    expect(rescan).not.toBeNull();
    await act(async () => {
      rescan?.click();
      await Promise.resolve();
    });

    expect(harness.services.rpc.calls.filter((call) => call.method === 'list').length).toBe(listsBefore + 1);
    // The run list is the TOPIC's answer, not the scan's: without the resync a
    // finished background job keeps reading `running` after the press.
    expect(topicRefreshes).toBe(1);

    act(() => render(null, container));
    container.remove();
    harness.dispose();
    configureUiKit(uiKitServices() ?? harness.services);
  });
});
