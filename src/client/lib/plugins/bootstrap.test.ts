/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin bootstrap's reconcile, driven through a real realtime server.
 *
 * Two bugs this suite pins, both silent in production:
 *
 * - **A disabled plugin's content script stayed mounted.** The reconcile keyed
 *   its live set on the SLOT ROWS, which nothing clears when a plugin is
 *   switched off — only a re-import does. Its `<link>` was removed (that hook
 *   reads the registry) while its DOM, listeners and scoping attribute stayed
 *   until a reload. Measured before the fix: `link=[]` and `generations=[…]`
 *   in the same snapshot. The registry payload is the whole truth, so the live
 *   set now comes from there.
 * - **A plugin's DOM had no CSS surface.** A content script is handed a `root`
 *   element carrying `data-plugin-surface`, which is what the served stylesheet
 *   is scoped to. A script that mounted into `document.body` was unreachable by
 *   its own CSS.
 *
 * The topic a plugin is subscribed to IS the assertion here: a bootstrap that
 * read the rows instead of the registry would keep the generation alive after
 * the payload moved.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { PanelRegistryPayload } from '@/shared/types';
import { PluginBootstrap } from '@/client/lib/plugins/bootstrap';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import { resetContentScripts } from '@/client/lib/plugins/content-scripts';
import { resetPluginSlots } from '@/client/lib/plugins/slots';
import { resetPluginStylesheets } from '@/client/lib/plugins/stylesheets';
import { resetLoadedBundles } from '@/client/lib/plugins/loader';
import { pluginContext } from '@/client/lib/plugins/context';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_PANELS } from '@/shared/lib/realtime/protocol';
import type { ContentScriptContext } from '@ompchamber/plugin-sdk';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const nativeFetch = Bun.fetch;

let container: HTMLElement;
let server: RealtimeTestServer;

/** A payload naming the plugin, or an empty one when it is switched off. */
function payload(enabled: boolean): PanelRegistryPayload {
  return {
    panels: enabled
      ? [{ pluginId: 'demo', name: 'Demo', version: '1.0.0', appUrl: '/api/panels/bundle/demo.js', cssUrl: '/api/panels/css/demo.css' }]
      : [],
    marketplaces: [],
    errors: [],
    plugins: [{ pluginId: 'demo', name: 'Demo', version: '1.0.0', isPackage: true, built: true, enabled, bundled: false, gitOrigin: null }],
    catalog: [],
    disabledPanels: enabled ? [] : ['plugin:demo'],
    gitStatus: {},
    autoUpdate: false,
    syncBlocked: {},
  };
}

beforeEach(async () => {
  const resolver: TopicResolver = async () => payload(true);
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([[TOPIC_PANELS, resolver]]));
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  target.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

  resetListSlots();
  resetPluginSlots();
  resetContentScripts();
  resetPluginStylesheets();
  resetLoadedBundles();
  document.head.replaceChildren();
});

afterAll(() => {
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
  restoreDomGlobals();
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  resetListSlots();
  resetPluginSlots();
  resetContentScripts();
  resetPluginStylesheets();
  resetLoadedBundles();
  resetRealtimeClient();
  server?.stop();
});

/**
 * Let Preact's scheduled effects run until `done` holds.
 *
 * Preact schedules passive effects on a macrotask (`requestAnimationFrame`
 * where available, a `setTimeout` otherwise — and happy-dom has no rAF), and a
 * topic snapshot arrives over the socket, so the mount lands a tick or two
 * after `waitForTopic` resolves. Awaiting a FIXED number of ticks is what made
 * the first version of this suite assert against an empty registry: it read the
 * effect's own scheduling rather than the condition under test.
 *
 * So this waits on the condition. `setTimeout(0)` is the same mechanism Preact
 * uses, and the bound turns a never-satisfied condition into a fast failure
 * rather than a hang.
 */
async function waitFor(done: () => boolean, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (done()) return;
    await act(async () => {});
    const tick = Promise.withResolvers<void>();
    setTimeout(tick.resolve, 0);
    await tick.promise;
  }
}

/** Wait until the bootstrap has mounted exactly `count` content-script generations. */
function waitForGenerations(count: number): Promise<void> {
  return waitFor(() => generations().length === count);
}

/** Mount the bootstrap with a live content-script registration in the store. */
async function mountWithContentScript(): Promise<void> {
  registerListSlot('demo', 'contentScript', {
    id: 'shell',
    mount: (context: ContentScriptContext) => {
      const node = context.root.ownerDocument.createElement('span');
      node.id = 'demo-node';
      context.root.appendChild(node);
      return () => node.remove();
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, { sessionId: 's1', children: h(PluginBootstrap, { workspacePath: null }) }),
      container,
    );
  });
  await server.waitForTopic(TOPIC_PANELS, (value) => value !== null);
  await waitForGenerations(1);
}

/** The plugin's mounted generations, read off the host's own registry. */
function generations(): number[] {
  return (globalThis.__ompChamberContentScripts ?? []).map((entry) => entry.generation);
}

describe('PluginBootstrap', () => {
  test('mounts a live plugin into a scoped root', async () => {
    await mountWithContentScript();

    expect(generations()).toHaveLength(1);
    const surface = document.querySelector('[data-plugin-surface="demo"]');
    expect(surface).not.toBeNull();
    // The script's node is inside the surface, which is what its own CSS is
    // scoped to.
    expect(surface?.querySelector('#demo-node')).not.toBeNull();
  });

  test('disabling the plugin unmounts its content script without a reload', async () => {
    await mountWithContentScript();
    expect(generations()).toHaveLength(1);

    // The user's own switch: the registry payload moves, nothing re-imports.
    await act(async () => {
      server.publish(TOPIC_PANELS, payload(false));
    });
    await waitForGenerations(0);

    // Before the fix this stayed at 1: the rows were never cleared, so the
    // reconcile saw the plugin as still live and never ran its disposer.
    expect(generations()).toHaveLength(0);
    expect(document.querySelector('[data-plugin-surface="demo"]')).toBeNull();
    expect(document.getElementById('demo-node')).toBeNull();
  });

  test('re-enabling the plugin mounts it again', async () => {
    await mountWithContentScript();
    await act(async () => {
      server.publish(TOPIC_PANELS, payload(false));
    });
    await waitForGenerations(0);
    expect(generations()).toHaveLength(0);

    await act(async () => {
      server.publish(TOPIC_PANELS, payload(true));
    });
    await waitForGenerations(1);

    expect(generations()).toHaveLength(1);
    expect(document.querySelector('[data-plugin-surface="demo"]')).not.toBeNull();
  });

  /**
   * The workspace the bootstrap was HANDED reaches the plugin context.
   *
   * This is what the phone layout was missing entirely: it mounted no
   * `PluginBootstrap`, so `usePanelInfo()` answered the kit's module default
   * (`workspacePath: null`) and every plugin panel drew "no workspace" over a
   * real one — while the panel itself still rendered, because the panel catalog
   * loads bundles on its own. The failure therefore looked like a plugin that
   * half worked rather than a missing mount.
   *
   * `workspacePath` is asserted through the context the KIT reads, not through
   * the bootstrap's own props, because the context is the only thing a plugin
   * can see.
   */
  test('publishes the workspace it was given into the plugin context', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(
        h(SessionStateProvider, { sessionId: 's1', children: h(PluginBootstrap, { workspacePath: '/tmp/ws-demo' }) }),
        container,
      );
    });

    // Read through the module the kit's services are installed from — the same
    // value `usePanelInfo()` returns to a plugin.
    expect(pluginContext()).toEqual({ sessionId: 's1', workspacePath: '/tmp/ws-demo', theme: expect.any(String) });
  });

  test('a later workspace change reaches the context', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const renderWith = (workspacePath: string | null) =>
      act(async () => {
        render(
          h(SessionStateProvider, { sessionId: 's1', children: h(PluginBootstrap, { workspacePath }) }),
          container,
        );
      });

    await renderWith('/tmp/ws-a');
    expect(pluginContext().workspacePath).toBe('/tmp/ws-a');

    // Re-rendered with a different root: the effect republishes, so a plugin
    // that reads the hook sees the new workspace without a reload.
    await renderWith('/tmp/ws-b');
    expect(pluginContext().workspacePath).toBe('/tmp/ws-b');
  });
});
