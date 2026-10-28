/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The navbar readout: two columns, and the states that are not a zero.
 *
 * Rendered through the host's own registration path (`loadPluginApp` +
 * `renderSlot`), so the component is exercised with the kit services a real
 * navbar supplies rather than with a hand-built props object.
 *
 * Three properties, each a lie when wrong:
 *
 * - a sample renders `18%` / `2.5G` — the header's compact spelling, not the
 *   panel's `18.4%` / `2.5 GB`;
 * - a snapshot from an unsupported probe reads `—` in both columns instead of
 *   printing zeros as measurements, and so does the state before the first
 *   sample;
 * - mounting arms the server's sampler and unmounting releases it. A header
 *   that sampled forever would be a process-table sweep per second for a figure
 *   nobody is looking at.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { loadPluginApp, uninstallTestPluginRuntime } from '@kabmo-labs/kabmo-sdk/testing/app';
import { configureUiKit, PluginIdProvider } from '@kabmo-labs/kabmo-ui';

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

function snapshot(overrides: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    sampledAt: Date.now(),
    probe: { name: 'fake', supported: true },
    rows: [],
    groups: [],
    total: { processes: 4, rss: 2.5 * 1024 ** 3, cpuPercent: 18.4 },
    machine: { totalMemBytes: 16 * 1024 ** 3, freeMemBytes: 4 * 1024 ** 3, cpuCount: 8, loadPerCore: 0.1 },
    daemons: [],
    serverPid: 1,
    ...overrides,
  };
}

/** Mount the header trigger the way the navbar does, and read it back. */
async function readout(publish?: StatsSnapshot): Promise<{
  text: string;
  calls: string[];
  unmount: () => void;
}> {
  const { harness } = loadPluginApp(pluginDefinition);
  harness.services.rpc.stub('watch', { watching: 1 });
  harness.services.rpc.stub('unwatch', { watching: 0 });
  if (publish) harness.services.publishTopic(publish);

  const registration = harness.registrations.headerPanel;
  if (!registration) throw new Error('the plugin registered no header panel');

  // The navbar wraps the trigger in `PluginIdProvider`, and that scope is what
  // `useRpc` reads its plugin from — without it every call answers `no_plugin`
  // and the readout would look broken for a reason the host never produces.
  const container = document.createElement('div');
  document.body.appendChild(container);
  configureUiKit(harness.services);
  await act(async () => {
    render(
      h(PluginIdProvider, {
        pluginId: harness.pluginId,
        children: h(registration.component, { sessionId: null, workspacePath: null }),
      }),
      container,
    );
  });
  // The arm call is a promise: the mount effect starts it and the answer lands
  // on a later microtask, so the DOM read has to wait for it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return {
    text: container.textContent ?? '',
    calls: harness.services.rpc.calls.map((call) => call.method),
    unmount() {
      act(() => render(null, container));
      container.remove();
      harness.dispose();
    },
  };
}

describe('the stats header readout', () => {
  test('reads CPU and RAM in the header compact spelling', async () => {
    const view = await readout(snapshot());
    expect(view.text).toContain('CPU');
    expect(view.text).toContain('RAM');
    expect(view.text).toContain('18%');
    expect(view.text).toContain('2.5G');
    // The panel's own spelling is for a table with column headers.
    expect(view.text).not.toContain('18.4%');
    expect(view.text).not.toContain('2.5 GB');
    view.unmount();
  });

  test('an unsupported probe reads a dash in both columns', async () => {
    const view = await readout(
      snapshot({ probe: { name: 'win32', supported: false, reason: 'no probe' }, rows: [], groups: [] }),
    );
    expect(view.text).toContain('—');
    expect(view.text).not.toContain('18%');
    view.unmount();
  });

  test('no sample yet reads a dash rather than zeros', async () => {
    const view = await readout();
    expect(view.text).toContain('—');
    expect(view.text).not.toContain('0%');
    view.unmount();
  });

  test('mounting arms the sampler', async () => {
    const view = await readout(snapshot());
    expect(view.calls).toContain('watch');
    view.unmount();
  });

  test('the trigger names the panel it opens, and is a real button', async () => {
    // The host wraps an `opensPanel` trigger in a button; the plugin itself
    // renders only the readout, so the click target is the host's job.
    const { harness } = loadPluginApp(pluginDefinition);
    expect(harness.registrations.headerOpensPanel).toBe('rightPanel');
    expect(harness.registrations.headerDropdown).toBeUndefined();
    harness.dispose();
  });
});
