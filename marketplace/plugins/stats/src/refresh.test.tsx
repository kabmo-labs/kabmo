/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Stats panel's Refresh control, mounted the way the host mounts it.
 *
 * Two reads make up one press, and each covers something the other does not:
 *
 * - the forced sample MEASURES — the server takes a snapshot now instead of
 *   waiting for its loop's next tick;
 * - the topic resync RE-DELIVERS it — the publish reaches a healthy socket by
 *   push, so a reader whose socket missed that frame would otherwise watch the
 *   button spin and the panel keep the numbers it already had.
 *
 * Kept out of `app.test.tsx` because it is one self-contained concern and that
 * file is at the repo's per-file ceiling.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { loadPluginApp, uninstallTestPluginRuntime } from '@kabmo-labs/kabmo-sdk/testing/app';
import type { FakeKabmoHarness } from '@kabmo-labs/kabmo-sdk/testing';
import {
  PanelHostProvider,
  PluginIdProvider,
  configureUiKit,
  uiKitServices,
  type UiKitServices,
} from '@kabmo-labs/kabmo-ui';

import pluginDefinition from './app';
import type { StatsSnapshot } from './sampler';

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

function snapshot(): StatsSnapshot {
  return {
    sampledAt: Date.now(),
    probe: { name: 'fake', supported: true },
    rows: [
      {
        pid: 1,
        ppid: 0,
        title: 'Kabmo server',
        detail: 'the server itself · 1m',
        groupKey: 'kabmo',
        depth: 0,
        memory: 2 * 1024 * 1024,
        memorySource: 'rss',
        rss: 2 * 1024 * 1024,
        cpuPercent: 1.5,
        threads: 4,
      },
    ],
    groups: [
      {
        key: 'kabmo',
        kind: 'kabmo',
        ownerPid: 1,
        title: 'Kabmo server',
        detail: 'the server itself · 1m',
        processes: 1,
        memory: 2 * 1024 * 1024,
        cpuPercent: 1.5,
      },
    ],
    total: { processes: 1, memory: 2 * 1024 * 1024, cpuPercent: 1.5 },
    memorySource: 'rss',
    machine: { totalMemBytes: 8 * 1024 ** 3, freeMemBytes: 1024 ** 3, cpuCount: 8, loadPerCore: 0.1 },
    daemons: [],
    serverPid: 1,
  };
}

async function renderStatsPanel(harness: FakeKabmoHarness, services: UiKitServices): Promise<HTMLElement> {
  const registration = harness.registrations.rightPanel;
  if (!registration) throw new Error('the plugin registered no right panel');
  configureUiKit(services);

  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(PanelHostProvider, {
        value: { sessionId: null, enabled: true, active: true, refreshKey: 0 },
        children: h(PluginIdProvider, {
          pluginId: PLUGIN_ID,
          children: h(registration.component, { sessionId: null, workspacePath: null }),
        }),
      }),
      container,
    );
  });
  // The arm call is a PROMISE: the mount effect starts it and the sampler's
  // first snapshot lands on a later task, so the Refresh control exists only
  // after the panel has settled.
  await act(async () => {
    const tick = Promise.withResolvers<void>();
    setTimeout(tick.resolve, 0);
    await tick.promise;
  });
  return container;
}

describe('StatsPanel refresh control', () => {
  test('Refresh measures now AND asks the topic for its snapshot again', async () => {
    const { harness } = loadPluginApp(pluginDefinition);
    harness.services.rpc.stub('watch', { watching: 1 });
    harness.services.rpc.stub('snapshot', snapshot());
    harness.services.publishTopic(snapshot());
    let topicRefreshes = 0;
    const container = await renderStatsPanel(harness, {
      ...harness.services,
      refreshPluginTopic: () => {
        topicRefreshes += 1;
      },
    });

    const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="Refresh stats"]');
    expect(refresh).not.toBeNull();
    await act(async () => {
      refresh?.click();
      const tick = Promise.withResolvers<void>();
      setTimeout(tick.resolve, 0);
      await tick.promise;
    });

    const calls = harness.services.rpc.calls;
    expect(
      calls.some(
        (call) => call.method === 'snapshot' && (call.input as { force?: boolean } | undefined)?.force === true,
      ),
    ).toBe(true);
    // Without this the press is a no-op on a socket that missed the publish.
    expect(topicRefreshes).toBe(1);

    act(() => render(null, container));
    container.remove();
    harness.dispose();
    configureUiKit(uiKitServices() ?? harness.services);
  });
});
