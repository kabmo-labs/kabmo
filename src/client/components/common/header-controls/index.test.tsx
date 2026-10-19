/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The navbar's control ORDER, on both layouts.
 *
 * The two headers are separate components, so the order was written twice and
 * drifted: the phone drew reload → context → sign out → panel while the desktop
 * drew plugin slots → install → reload → sign out → editor → context → panel.
 * A user switching layouts had to re-find every control. The order now lives in
 * one component, and this suite asserts the RENDERED sequence — a table in a
 * module would pass while a call site rendered something else.
 *
 * Install is made visible by dispatching the real `beforeinstallprompt` event;
 * the sign-out control by priming the auth store with an enabled instance, the
 * same way the bootstrap does. Everything else is rendered from the real
 * components against a real realtime server, so the plugin slot is a genuine
 * registration rather than a stub.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';
import { HeaderControls } from '@/client/components/common/header-controls';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { registerPluginBundle, resetPluginSlots } from '@/client/lib/plugins/slots';
import { primeAuthState } from '@/client/hooks/ui/auth';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { invalidateModelsCache } from '@/shared/lib/models/client';
import { sessionTelemetryTopic, TOPIC_PANELS } from '@/shared/lib/realtime/protocol';
import type { PanelRegistryPayload } from '@/shared/types';
import type { SessionContextTelemetry } from '@/shared/types/context';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const SESSION = 'session-header-order';
const nativeFetch = Bun.fetch;
const Noop = () => null;

let container: HTMLElement;
let server: RealtimeTestServer;

/** A registry payload naming one installed plugin, so its header slot renders. */
const PANELS: PanelRegistryPayload = {
  panels: [{ pluginId: 'demo', name: 'Demo', version: '1.0.0', appUrl: '/api/panels/bundle/demo.js' }],
  marketplaces: [],
  errors: [],
  plugins: [{ pluginId: 'demo', name: 'Demo', version: '1.0.0', isPackage: true, built: true, enabled: true, bundled: false, gitOrigin: null }],
  catalog: [],
  disabledPanels: [],
  gitStatus: {},
  autoUpdate: false,
  syncBlocked: {},
};

function telemetry(): SessionContextTelemetry {
  return {
    sessionId: SESSION,
    sessionTitle: 'Header',
    modelId: 'kenari/deepseek-v4-1-flash',
    modelName: 'deepseek-v4-1-flash',
    timestamp: 'today',
    contextUsed: 12_000,
    contextLimit: 100_000,
    contextPercent: 12,
    messagesCount: 3,
    userCount: 1,
    assistantCount: 2,
    totalCost: 0.01,
    costFormatted: '$0.01',
    cacheHitAverage: 90,
    lastMessage: { input: 10, output: 4, reasoning: 0, cacheRead: 2, cacheWrite: 0, cacheHitPercent: 16.6 },
    distribution: { userTokens: 1, userPercent: 25, assistantTokens: 1, assistantPercent: 25, toolTokens: 1, toolPercent: 25, otherTokens: 1, otherPercent: 25 },
    rawMessages: [],
  };
}

beforeEach(async () => {
  // `/api/models` is cached in module state shared by the whole process.
  invalidateModelsCache();
  const panels: TopicResolver = async () => PANELS;
  const telemetryTopic: TopicResolver = async () => telemetry();
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC_PANELS, panels],
    [sessionTelemetryTopic(SESSION), telemetryTopic],
  ]));
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  target.fetch = async (input: unknown) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const url = String(input);
    if (url.includes('/api/sessions/')) return json({ state: {} });
    if (url.includes('/api/telemetry/context')) return json({ telemetry: telemetry() });
    if (url.includes('/api/models')) return json({ modelList: [], connectedProviders: [] });
    return json({});
  };

  resetPluginSlots();
  // The plugin's real registration path: the navbar reads the SLOT store, so a
  // stubbed entry would prove nothing about where the slot lands in the row.
  registerPluginBundle('demo', {
    default: definePluginApp((app) => app.headerPanel({ id: 'h', title: 'Demo Stats', component: Noop })),
  });
  // The sign-out control only exists on a password-protected instance.
  primeAuthState(true, true);
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  resetPluginSlots();
  resetRealtimeClient();
  server?.stop();
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

/** Let Preact's passive effects and the topic snapshots settle. */
async function settle(): Promise<void> {
  await server.waitForTopic(TOPIC_PANELS, (value) => value !== null);
  await server.waitForTopic(sessionTelemetryTopic(SESSION), (value) => value !== null);
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

/**
 * Every control in the cluster, in DOM order, by its accessible name.
 *
 * A plugin entry with no dropdown is a static READOUT — deliberately not a
 * `<button>` — so the walk collects titled elements too, or the plugin slot
 * would be invisible to an order assertion. The chord suffix a tooltip carries
 * (`Toggle Editor Layout (Ctrl+J)`) is stripped: it is the platform's spelling
 * of the shortcut, not part of the control's identity.
 */
function controlNames(): string[] {
  const seen = new Set<Element>();
  const names: string[] = [];
  for (const element of container.querySelectorAll('button, [title]')) {
    if (seen.has(element)) continue;
    seen.add(element);
    const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '';
    names.push(label.replace(/ \([^)]*\)$/, ''));
  }
  return names;
}

async function mount(layout: 'desktop' | 'mobile', props: { editor?: boolean; switch?: boolean } = {}): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(HeaderControls, {
          layout,
          sessionId: SESSION,
          showRightPanel: layout === 'desktop',
          onToggleRightPanel: () => {},
          ...(props.editor ? { showEditor: true, onToggleEditor: () => {} } : {}),
          ...(props.switch ? { onSwitchToMobile: () => {} } : {}),
        }),
      }),
      container,
    );
  });
  await settle();
  // Install is only drawn while the browser offers a prompt; dispatching the
  // real event is what a browser does, and it is the only way to see the slot.
  if (layout === 'desktop') {
    const prompt = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    prompt.prompt = async () => {};
    prompt.userChoice = Promise.resolve({ outcome: 'dismissed' });
    await act(async () => {
      window.dispatchEvent(prompt);
    });
  }
}

describe('HeaderControls', () => {
  test('desktop draws install, plugin slots, reload, context, lock, editor, panel', async () => {
    await mount('desktop', { editor: true, switch: true });

    expect(controlNames()).toEqual([
      'Install Kabmo',
      'Demo Stats',
      'Reload page',
      'Context usage',
      'Sign out',
      'Toggle Editor Layout',
      'Toggle Right Panel',
      'Switch to Mobile View',
    ]);
  });

  test('mobile draws the same controls in the same order, minus the desktop-only pair', async () => {
    await mount('mobile');

    // Install is desktop-only by decision: a phone's browser never fires the
    // prompt (iOS has its own guide), so the control is not part of the phone's
    // row. The editor column does not exist on the phone at all.
    expect(controlNames()).toEqual([
      'Demo Stats',
      'Reload page',
      'Context usage',
      'Sign out',
      'Open Right Panel',
    ]);
  });

  test('the shared controls sit in the same relative order on both layouts', async () => {
    await mount('desktop', { editor: true });
    const desktop = controlNames();
    render(null, container);
    container.remove();

    await mount('mobile');
    const mobile = controlNames();

    const shared = ['Reload page', 'Context usage', 'Sign out'];
    const positions = (names: string[]) => shared.map((name) => names.indexOf(name));
    expect(positions(desktop)).toEqual([2, 3, 4]);
    expect(positions(mobile)).toEqual([1, 2, 3]);
    // Each list is ordered, which is the property that was wrong.
    expect(positions(desktop)).toEqual([...positions(desktop)].sort((a, b) => a - b));
    expect(positions(mobile)).toEqual([...positions(mobile)].sort((a, b) => a - b));
  });
});
