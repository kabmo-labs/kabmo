/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Stats panel's "server half is not running" state.
 *
 * This is the state a user reported: the panel opened and said "No sample yet."
 * with nothing on screen to explain it. The cause is structural — a plugin's
 * server half is loaded at Kabmo STARTUP, so a plugin installed into a running
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
import { loadPluginApp, uninstallTestPluginRuntime } from '@kabmo-labs/kabmo-sdk/testing/app';
import type { FakeKabmoHarness } from '@kabmo-labs/kabmo-sdk/testing';
import { PanelHostProvider, PluginIdProvider, configureUiKit, uiKitServices } from '@kabmo-labs/kabmo-ui';

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
async function renderStatsPanel(
  harness: FakeKabmoHarness,
): Promise<{ text: string; html: string; unmount: () => void }> {
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
    html: container.innerHTML ?? '',
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

/** The rendered MARKUP, for assertions about classes rather than text. */
async function htmlFor(options: { live?: boolean; publish?: StatsSnapshot } = {}): Promise<string> {
  const { harness } = loadPluginApp(pluginDefinition);
  if (options.live) harness.services.rpc.stub('watch', { watching: 1 });
  if (options.publish) harness.services.publishTopic(options.publish);
  const rendered = await renderStatsPanel(harness);
  const html = rendered.html;
  rendered.unmount();
  harness.dispose();
  configureUiKit(uiKitServices() ?? harness.services);
  return html;
}

describe('StatsPanel server-half state', () => {
  test('a plugin_not_loaded arm refusal names the cause and the fix', async () => {
    const text = await textFor();
    expect(text).toContain('server half is not running');
    expect(text).toContain('restart Kabmo');
    // It must not claim the stack is idle or empty.
    expect(text).not.toContain('No sample yet');
  });

  test('a live arm call with a published snapshot renders the table', async () => {
    const text = await textFor({ live: true, publish: snapshot() });
    expect(text).toContain('Kabmo server');
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
        groups: [],
        total: { processes: 0, memory: 0, cpuPercent: 0 },
        memorySource: 'rss',
        error: 'no subprocess-free route',
      }),
    });
    expect(text).toContain('no subprocess-free route');
  });

  test('the sparkline legend is FORMATTED, never a raw byte count', async () => {
    // The failure this pins: the legend printed `1332543488.0 – 1511997440.0`,
    // 163px of unbreakable text, which forced the panel's minimum width to
    // 359px and clipped the table's right-hand columns on a narrow panel.
    const text = await textFor({
      live: true,
      publish: snapshot({
        history: { memory: [1_400_000_000, 1_500_000_000], cpuPercent: [2.5, 12.0] },
      }),
    });
    expect(text).not.toMatch(/\d{9,}\.\d/);
    expect(text).toContain('GB');
    expect(text).toContain('–');
  });

  test('the two least important columns collapse on a narrow panel', async () => {
    // The failure this pins: five fixed columns summed to 228px, so below a
    // ~280px panel the table overflowed and the right-hand columns sat under a
    // horizontal scrollbar. The optional columns carry the `@container` query
    // that drops them — asserted as MARKUP, because happy-dom does not run
    // container queries, and a missing class is exactly the regression.
    const html = await htmlFor({ live: true, publish: snapshot() });
    expect(html).toContain('@container');
    expect(html).toContain('@max-[360px]:hidden');
    expect(html).toContain('@max-[300px]:hidden');
  });
});

/** A row the panel may stop, beside the one it may not. */
function killableSnapshot(): StatsSnapshot {
  const base = snapshot();
  const server = base.rows[0];
  const host = {
    ...server,
    pid: 101,
    ppid: server.pid,
    title: 'omp · rpc-ui',
    detail: 'project · 2m',
    groupKey: 'session',
    depth: 1,
  };
  return {
    ...base,
    rows: [server, host],
    // The table renders GROUPS and then their rows, so a row without a group
    // is a row the panel never draws.
    groups: [base.groups[0], { ...base.groups[0], key: 'session', kind: 'session', ownerPid: 101, title: host.title, detail: host.detail }],
  };
}

describe('StatsPanel kill control', () => {
  test('the × exists for a measured process and never for the server itself', async () => {
    const { harness } = loadPluginApp(pluginDefinition);
    harness.services.rpc.stub('watch', { watching: 1 });
    harness.services.publishTopic(killableSnapshot());
    const rendered = await renderStatsPanel(harness);

    expect(rendered.html).toContain('aria-label="Stop pid 101"');
    expect(rendered.html).not.toContain('aria-label="Stop pid 1"');

    rendered.unmount();
    harness.dispose();
    configureUiKit(uiKitServices() ?? harness.services);
  });

  test('clicking × opens the dialog, and Cancel closes it without a kill', async () => {
    const { harness } = loadPluginApp(pluginDefinition);
    harness.services.rpc.stub('watch', { watching: 1 });
    harness.services.rpc.stub('kill', { killed: true, pid: 101, title: 'omp · rpc-ui', signal: 'SIGTERM' });
    harness.services.publishTopic(killableSnapshot());
    const rendered = await renderStatsPanel(harness);

    const container = document.body.lastElementChild as HTMLElement;
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Stop pid 101"]');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
    expect(container.textContent).toContain('Stop pid 101?');

    const cancel = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Cancel');
    await act(async () => {
      cancel?.click();
    });
    expect(container.textContent).not.toContain('Stop pid 101?');
    expect(harness.services.rpc.calls.filter((call) => call.method === 'kill')).toHaveLength(0);

    rendered.unmount();
    harness.dispose();
    configureUiKit(uiKitServices() ?? harness.services);
  });

  test('confirming sends the pid and forces a sample so the row disappears', async () => {
    const { harness } = loadPluginApp(pluginDefinition);
    harness.services.rpc.stub('watch', { watching: 1 });
    harness.services.rpc.stub('kill', { killed: true, pid: 101, title: 'omp · rpc-ui', signal: 'SIGTERM' });
    harness.services.rpc.stub('snapshot', killableSnapshot());
    harness.services.publishTopic(killableSnapshot());
    const rendered = await renderStatsPanel(harness);

    const container = document.body.lastElementChild as HTMLElement;
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Stop pid 101"]')?.click();
    });
    const stop = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Stop process');
    await act(async () => {
      stop?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const calls = harness.services.rpc.calls;
    expect(calls.filter((call) => call.method === 'kill').map((call) => call.input)).toEqual([{ pid: 101 }]);
    expect(calls.some((call) => call.method === 'snapshot' && (call.input as { force?: boolean } | undefined)?.force === true)).toBe(true);

    rendered.unmount();
    harness.dispose();
    configureUiKit(uiKitServices() ?? harness.services);
  });
});
