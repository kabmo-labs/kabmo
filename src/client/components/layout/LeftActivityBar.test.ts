/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The LEFT rail: what it draws, and what it refuses to draw.
 *
 * Three properties, and each is a bug the right rail's shape would produce if
 * the left one were a copy of it:
 *
 * - **The session list is always on it and cannot be switched off.** It is the
 *   only way back to a conversation, so the visibility menu lists it as pinned
 *   rather than offering a switch that would strand the user.
 * - **The rail draws only what the LEFT column can show.** A menu of eleven
 *   built-in views it cannot render would be a list of controls that do nothing.
 * - **A plugin is on exactly one rail.** Its placement decides which, so the
 *   same panel cannot be two buttons — one of which would draw nothing.
 *
 * Rendered with `h()` (no JSX) against happy-dom, through the real session-state
 * provider: the rail reads placement from the settings snapshot, which is module
 * state a test has to prime.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ActivityBar } from '@/client/components/layout/ActivityBar';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { registerPluginBundle, resetPluginSlots } from '@/client/lib/plugins/slots';
import { resetPanelRegistry } from '@/client/hooks/workspace/panel-registry';
import { LEFT_DOCK_SETTING_KEY } from '@/shared/lib/workspace/left-dock';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_PANELS } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import {
  installDomGlobals,
  pristineWebSocket,
  restoreDomGlobals,
} from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const SESSION = 'new-left-rail';
const nativeFetch = Bun.fetch;
let container: HTMLElement | null = null;
let server: RealtimeTestServer;

/**
 * ONE harness per file, started before any case — the rule the helper documents:
 * the hub, its topics and the listener are process state, so a server started
 * per test leaves the previous one's socket to report its close into the NEXT
 * file's globals (`Unhandled error. (ErrorEvent …)`, measured).
 */
beforeAll(async () => {
  // The rail reads the plugin registry, which is a realtime topic — so the test
  // needs a real channel rather than a stub, the same reason the right rail's
  // suite starts one.
  const registry: TopicResolver = async () => ({
    // `demo` is INSTALLED; whether it draws a button depends on its bundle
    // having registered a component, which is what the placement case sets up.
    panels: [{ pluginId: 'demo', name: 'demo', version: '1.0.0', appUrl: '/api/panels/bundle/demo' }],
    marketplaces: [],
    errors: [],
    plugins: [],
    catalog: [],
    disabledPanels: [],
    gitStatus: {},
    autoUpdate: false,
    syncBlocked: {},
  });
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([[TOPIC_PANELS, registry]]));
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
});

beforeEach(() => {
  const win = new Window({ url: `http://127.0.0.1:${server.port}` });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  primeKabmoSettings({});
  resetRealtimeClient();
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = nativeFetch;
  restoreDomGlobals();
  server.stop();
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = null;
  }
  primeKabmoSettings({});
  resetRealtimeClient();
  // The registry store is a `globalThis` slot, so a payload adopted here would
  // be every later suite's starting state — the right rail would draw this
  // file's plugin.
  resetPanelRegistry();
  resetPluginSlots();
});

async function mount() {
  // The registry is a realtime read: the bar draws plugins only once the
  // payload has been adopted, so the mount waits for the client's own value
  // rather than for a duration.
  await server.waitForTopic(TOPIC_PANELS, (value) => value !== null);
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(ActivityBar, {
          side: 'left',
          activePanel: 'sessions',
          onChangePanel: () => {},
          isPanelOpen: true,
          hasActiveContext: true,
        }),
      }),
      container!,
    );
  });
  await flush();
}

/**
 * Let the channel's frames land and the tree re-render.
 *
 * The registry arrives over a real socket, so a microtask flush is not enough:
 * the frame is a macrotask. This yields to the event loop a bounded number of
 * times rather than sleeping a guessed duration.
 */
async function flush(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

const labels = () =>
  [...(container?.querySelectorAll('nav button[aria-label]') ?? [])].map((el) => el.getAttribute('aria-label') ?? '');

describe('left activity bar', () => {
  test('draws the session list, and nothing from the right column', async () => {
    await mount();
    expect(labels()).toEqual(['Sessions']);
  });

  test('the sessions row is offered as pinned, not switchable', async () => {
    await mount();
    const nav = container!.querySelector('nav') as HTMLElement;
    await act(async () => {
      nav.dispatchEvent(new window.Event('contextmenu', { bubbles: true, cancelable: true }));
    });
    const menu = document.querySelector('[role="menu"][aria-label="Panel visibility"]');
    expect(menu).not.toBeNull();
    const row = [...menu!.querySelectorAll('[role="menuitemcheckbox"]')].find(
      (el) => el.textContent?.includes('Sessions'),
    ) as HTMLButtonElement;
    expect(row).toBeDefined();
    // Disabled and still checked: the row exists so the menu is complete, and
    // it says the view cannot be put away rather than pretending a click works.
    expect(row.disabled).toBe(true);
    expect(row.getAttribute('aria-checked')).toBe('true');
    // The built-ins are RIGHT-column views and are not offered here at all.
    expect(menu!.textContent).not.toContain('Source Control');
    menu!.parentElement?.remove();
  });

  test('a placed plugin panel is drawn here and gone from the right rail', async () => {
    // One bundle, registered the way a loaded plugin registers it, and a
    // registry that names it — then the placement decides the rail.
    registerPluginBundle('demo', {
      default: definePluginApp((app) => app.rightPanel({ id: 'main', title: 'Demo panel', component: () => null })),
    });
    // The INSTANCE key (plugin + slot). A bare `plugin:demo` still resolves —
    // to the right-panel instance — but the dock holds instance keys, so that
    // is what a placement writes.
    primeKabmoSettings({ [LEFT_DOCK_SETTING_KEY]: { enabled: true, panels: ['plugin:demo:rightPanel'] } });
    await mount();
    expect(labels()).toEqual(['Sessions', 'Demo panel — demo']);

    // The same plugin on the RIGHT: the left rail loses the button, because a
    // panel is on one rail at a time.
    primeKabmoSettings({ [LEFT_DOCK_SETTING_KEY]: { enabled: true, panels: [] } });
    render(null, container!);
    container = null;
    await mount();
    expect(labels()).toEqual(['Sessions']);
  });
});
