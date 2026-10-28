/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A plugin's navbar entry, and where it goes when the row runs out of room.
 *
 * Two facts, and both are a control that becomes unreachable when broken:
 *
 * - an `opensPanel` entry is an ACTION: the row's button asks the layout for
 *   the plugin's panel by its instance key, so the layout can open it wherever
 *   the user placed it;
 * - on a phone too narrow to hold it, that action MOVES into the `⋯` menu
 *   rather than shrinking or disappearing. Measured with a `CPU 18% / RAM 2.5G`
 *   readout (73px) at 390px: the session title kept 48px of its 74px and was
 *   clipped. At 430px it kept all of it, which is why that is the threshold.
 *
 * Rendered through the real `HeaderControls` against a real realtime server: the
 * split between the row and the menu lives in that component's own call, so a
 * test of the resolver alone would pass while the call site rendered something
 * else.
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

const SESSION = 'session-header-plugin-entry';
const nativeFetch = Bun.fetch;
const Noop = () => null;

let container: HTMLElement;
let server: RealtimeTestServer;

const PANELS: PanelRegistryPayload = {
  panels: [{ pluginId: 'demo', name: 'Demo', version: '1.0.0', appUrl: '/api/panels/bundle/demo.js' }],
  marketplaces: [],
  errors: [],
  plugins: [{ pluginId: 'demo', name: 'Demo', version: '1.0.0', isPackage: true, built: true, enabled: true, bundled: false, origin: 'local', gitOrigin: null }],
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

/** Register a plugin whose header ACTION opens its own right panel. */
function registerActionPlugin(): void {
  registerPluginBundle('demo', {
    default: definePluginApp((app) => {
      app.rightPanel({ id: 'r', title: 'Resources', component: Noop });
      app.headerPanel({ id: 'h', title: 'Demo Stats', component: Noop, opensPanel: 'rightPanel' });
    }),
  });
}

beforeEach(async () => {
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
  registerActionPlugin();
  // No password: the sign-out control would otherwise add a row to the menu
  // this suite asserts on.
  primeAuthState(false, false);
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

async function mount(layout: 'desktop' | 'mobile', width: number): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(HeaderControls, {
          layout,
          sessionId: SESSION,
          showRightPanel: false,
          onToggleRightPanel: () => {},
        }),
      }),
      container,
    );
  });
  await server.waitForTopic(TOPIC_PANELS, (value) => value !== null);
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

/** Every control in the row, by its accessible name. */
function rowNames(): string[] {
  return [...container.querySelectorAll('button, [title]')]
    .map((element) => element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '')
    .map((label) => label.replace(/ \([^)]*\)$/, ''));
}

describe('a plugin header action', () => {
  test('desktop: a button that asks for its own panel by instance key', async () => {
    await mount('desktop', 1024);

    const events: string[] = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ panelKey?: string }>).detail;
      if (detail?.panelKey) events.push(detail.panelKey);
    };
    window.addEventListener('omp:open-panel', listener);
    const button = container.querySelector('button[aria-label="Demo Stats"]') as HTMLElement;
    expect(button).toBeTruthy();
    await act(async () => {
      button.click();
    });
    window.removeEventListener('omp:open-panel', listener);

    expect(events).toEqual(['plugin:demo:rightPanel']);
  });

  test('a narrow phone folds it into the menu, and the row keeps the title space', async () => {
    await mount('mobile', 390);

    expect(rowNames()).not.toContain('Demo Stats');

    const trigger = container.querySelector('button[aria-label="More actions"]') as HTMLElement;
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger.click();
    });
    // The row IS the plugin's readout: the title is its accessible name, not a
    // second label printed beside the same figures.
    const row = container.querySelector('[role="menu"] [role="menuitem"][aria-label="Demo Stats"]');
    expect(row).toBeTruthy();
  });

  test('the menu row opens the panel, on the same event', async () => {
    await mount('mobile', 390);
    const trigger = container.querySelector('button[aria-label="More actions"]') as HTMLElement;
    await act(async () => {
      trigger.click();
    });

    const events: string[] = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ panelKey?: string }>).detail;
      if (detail?.panelKey) events.push(detail.panelKey);
    };
    window.addEventListener('omp:open-panel', listener);
    const row = container.querySelector('[role="menu"] [role="menuitem"][aria-label="Demo Stats"]') as HTMLElement;
    await act(async () => {
      row.click();
    });
    window.removeEventListener('omp:open-panel', listener);

    expect(events).toEqual(['plugin:demo:rightPanel']);
  });

  test('a wide enough phone keeps it in the row', async () => {
    await mount('mobile', 500);
    expect(rowNames()).toContain('Demo Stats');
  });
});
