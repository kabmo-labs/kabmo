/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's navbar row, and what the `⋯` menu holds when the row runs out.
 *
 * Split out of `index.test.tsx` for the file-size ceiling, along the seam the
 * two facts already had: `index` is the DESKTOP order (what is drawn, and in
 * which order), this is the phone's FOLD (what moves into the menu at a given
 * width).
 *
 * The fold is a width, not a device class. `MOBILE_FULL_ROW_PX` is measured
 * against the row's real content — the wordmark, the session picker and the
 * lock bit — so a case that does not say where it is mounted is asserting a
 * layout nobody chose. Every case here names its width for that reason, and
 * happy-dom resolves `matchMedia` against `innerWidth`, which is the same
 * signal a real resize raises.
 *
 * The harness is the real `HeaderControls` against a real realtime server: the
 * split between the row and the menu lives in that component's own call, so a
 * test of the width rule alone would pass while the call site drew something
 * else.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';
import { HeaderControlsHarness } from '@/test-support/header-controls-harness';
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

const SESSION = 'session-header-phone-row';
const nativeFetch = Bun.fetch;
const Noop = () => null;

let container: HTMLElement;
let server: RealtimeTestServer;

/** A registry payload naming one installed plugin, so its header slot renders. */
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
  registries: [],
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

/** Mount the phone's row at a chosen viewport width. */
async function mountPhone(width: number, hidden?: string[]): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(HeaderControlsHarness, {
          layout: 'mobile',
          sessionId: SESSION,
          showRightPanel: false,
          onToggleRightPanel: () => {},
          ...(hidden ? { hidden } : {}),
        }),
      }),
      container,
    );
  });
  await server.waitForTopic(TOPIC_PANELS, (value) => value !== null);
  await server.waitForTopic(sessionTelemetryTopic(SESSION), (value) => value !== null);
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

async function openMenu(): Promise<HTMLElement> {
  const trigger = container.querySelector('button[aria-label="More actions"]') as HTMLElement;
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger.click();
  });
  const menu = container.querySelector('[role="menu"]') as HTMLElement;
  expect(menu).toBeTruthy();
  return menu;
}

describe('the phone row', () => {
  test('a narrow phone draws the row, minus the desktop-only pair', async () => {
    await mountPhone(390);

    // Install is desktop-only by decision: a phone's browser never fires the
    // prompt (iOS has its own guide), so the control is not part of the phone's
    // row. The editor column does not exist on the phone at all.
    //
    // At 390px reload and sign-out are rows of the `⋯` menu rather than
    // standing in the row: that is what pays for the wordmark and the session
    // title (see `HeaderControls`' own doc).
    expect(controlNames()).toEqual([
      'Demo Stats',
      'Context usage',
      'Open Right Panel',
      'More actions',
    ]);
  });

  test('a narrow phone folds reload and sign-out into the ⋯ menu', async () => {
    await mountPhone(360);

    // Below `MOBILE_FULL_ROW_PX` the row cannot hold them beside a full-width
    // picker, so they are rows of the `⋯` menu instead.
    expect(controlNames()).toEqual([
      'Demo Stats',
      'Context usage',
      'Open Right Panel',
      'More actions',
    ]);
  });

  test('a phone wide enough for the whole row draws every control, no menu', async () => {
    // 500px is past both thresholds (400 open, 436 with the lock), so nothing
    // is folded: the fold is a width, not a device class.
    await mountPhone(500);

    expect(controlNames()).toEqual([
      'Demo Stats',
      'Reload page',
      'Context usage',
      'Sign out',
      'Open Right Panel',
    ]);
  });

  test('the folded controls stay one click away, not absent', async () => {
    await mountPhone(360);

    expect(controlNames()).not.toContain('Reload page');
    expect(controlNames()).not.toContain('Sign out');

    const trigger = container.querySelector('button[aria-label="More actions"]') as HTMLElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    const menu = await openMenu();
    expect(menu.textContent).toContain('Reload page');
    expect(menu.textContent).toContain('Sign out');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  test('a control switched off is gone from the ⋯ menu too', async () => {
    await mountPhone(360, ['reload']);

    const menu = await openMenu();
    expect(menu.textContent).not.toContain('Reload page');
    // Sign out is still off the row, so the menu keeps its row and the trigger
    // still has something to offer.
    expect(menu.textContent).toContain('Sign out');

    render(null, container);
    container.remove();
    await mountPhone(360, ['reload', 'signout']);
    // Nothing folded and nothing left in the menu: the trigger is not drawn,
    // rather than opening an empty panel.
    expect(container.querySelector('button[aria-label="More actions"]')).toBeNull();
  });
});
