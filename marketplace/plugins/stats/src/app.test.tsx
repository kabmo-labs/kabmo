/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Stats panel's "server half is not running" state.
 *
 * This is the state a user reported: the panel opened and said "No sample yet."
 * with nothing on screen to explain it. The cause is structural — a plugin's
 * server half is loaded at chamber STARTUP, so a plugin installed into a running
 * instance answers no topic and refuses its RPC methods until a restart.
 *
 * The panel detects it through its own arm call: `watch` is an RPC method on the
 * plugin's server half, so a 404 there means the half is not loaded. The host's
 * kit maps that 404 to `plugin_not_loaded` (rather than the generic
 * `bad_response`) precisely so a panel can tell it apart from a broken call.
 *
 * Rendered the way the HOST renders a plugin — through `PluginIdProvider` and
 * `PanelHostProvider` — because the kit's `useRpc` resolves its plugin id from
 * the first, and a harness that skipped it would exercise a component that never
 * subscribes.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { loadPluginApp, uninstallTestPluginRuntime } from '@ompchamber/plugin-sdk/testing/app';
import type { FakeChamberHarness } from '@ompchamber/plugin-sdk/testing';
import { PanelHostProvider, PluginIdProvider, configureUiKit, uiKitServices } from '@ompchamber/ui';

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

/** Render the plugin's right panel the way the host does. */
async function renderStatsPanel(harness: FakeChamberHarness): Promise<{ text: string; unmount: () => void }> {
  const registration = harness.registrations.rightPanel;
  if (!registration) throw new Error('the plugin registered no right panel');
  configureUiKit(harness.services);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const body = { sessionId: null, enabled: true, active: true, refreshKey: 0 };
  await act(async () => {
    render(
      h(PanelHostProvider, {
        value: body,
        children: h(PluginIdProvider, {
          pluginId: PLUGIN_ID,
          children: h(registration.component, { sessionId: null, workspacePath: null }),
        }),
      }),
      container,
    );
  });
  // The arm call is a PROMISE: the mount effect starts it, and the refusal (or
  // the success) lands on a later microtask. Reading the DOM before it settles
  // sees the pre-refusal render — the "Sampling…" line — for every case.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return {
    text: container.textContent ?? '',
    unmount() {
      act(() => render(null, container));
      container.remove();
    },
  };
}

function snapshot(overrides: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    sampledAt: Date.now(),
    probe: { name: 'fake', supported: true },
    rows: [
      { pid: 1, ppid: 0, category: 'chamber', command: 'index.ts', rss: 2 * 1024 * 1024, cpuPercent: 1.5, threads: 4 },
    ],
    totals: [{ category: 'chamber', processes: 1, rss: 2 * 1024 * 1024, cpuPercent: 1.5 }],
    total: { processes: 1, rss: 2 * 1024 * 1024, cpuPercent: 1.5 },
    machine: { totalMemBytes: 8 * 1024 ** 3, freeMemBytes: 1024 ** 3, cpuCount: 8, loadPerCore: 0.1 },
    daemons: [],
    serverPid: 1,
    ...overrides,
  };
}

/** Load, stub the arm call, optionally publish, render, and tear down. */
async function textFor(options: { live?: boolean; publish?: StatsSnapshot } = {}): Promise<string> {
  const { harness } = loadPluginApp(pluginDefinition);
  if (options.live) harness.services.rpc.stub('watch', { watching: 1 });
  else
    harness.services.rpc.stubError('watch', {
      code: 'plugin_not_loaded',
      message: `no plugin "${PLUGIN_ID}" is loaded on the server`,
    });
  if (options.publish) harness.services.publishTopic(options.publish);

  const rendered = await renderStatsPanel(harness);
  const text = rendered.text;
  rendered.unmount();
  harness.dispose();
  configureUiKit(uiKitServices() ?? harness.services);
  return text;
}

describe('StatsPanel server-half state', () => {
  test('a plugin_not_loaded arm refusal names the cause and the fix', async () => {
    const text = await textFor();
    expect(text).toContain('server half is not running');
    expect(text).toContain('restart OMPChamber');
    // It must not claim the stack is idle or empty.
    expect(text).not.toContain('No sample yet');
  });

  test('a live arm call with a published snapshot renders the table', async () => {
    const text = await textFor({ live: true, publish: snapshot() });
    expect(text).toContain('Chamber');
    expect(text).not.toContain('server half is not running');
  });

  test('a live arm call with no sample yet shows the sampling line', async () => {
    const text = await textFor({ live: true });
    expect(text).toContain('Sampling the process table…');
    expect(text).not.toContain('server half is not running');
  });

  test('an unsupported probe reports the platform, not an empty list', async () => {
    const text = await textFor({
      live: true,
      publish: snapshot({
        probe: { name: 'win32', supported: false, reason: 'no subprocess-free route' },
        rows: [],
        totals: [],
        total: { processes: 0, rss: 0, cpuPercent: 0 },
        error: 'no subprocess-free route',
      }),
    });
    expect(text).toContain('no subprocess-free route');
  });
});
