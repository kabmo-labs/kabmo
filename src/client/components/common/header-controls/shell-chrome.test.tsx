/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell chrome the shared cluster must carry, on BOTH layouts.
 *
 * Two bugs reached a user, and both are invisible in a browser:
 *
 * 1. **`app-region` inherits.** WebView2's own spec says the property inherits,
 *    and Chromium 152 began enforcing it. So a header marked `app-region: drag`
 *    turns every descendant into a drag handle — and a drag handle swallows the
 *    click, silently. The desktop navbar wrapped this cluster in a
 *    `titlebar-no-drag` div and the PHONE's header did not, so on Windows every
 *    control in a phone-width window (reload, context, sign out, the right
 *    panel, `⋯`) looked right and did nothing.
 * 2. **The page-drawn caption buttons lived in one layout.** A desktop shell
 *    window can be narrower than `App`'s 768px breakpoint — all three shells
 *    allow a 720px window — so a Windows/Linux window resized down switches to
 *    the phone layout, which drew no close/minimise/maximise at all and had no
 *    native title bar behind them.
 *
 * Both are asserted on the RENDERED tree, because both were a call site's
 * omission: a test reading the component's source would have passed while the
 * phone stayed broken. macOS is covered too — it keeps its own traffic lights,
 * so the page must draw no second set.
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
import type { PanelRegistryPayload, SessionContextTelemetry } from '@/shared/types';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const SESSION = 'session-shell-chrome';
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
    sessionTitle: 'Shell',
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

/** The shell's two globals, which the DOM's own `window` type does not declare. */
type Shell = {
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  __kabmoDesktop?: Record<string, unknown>;
};


const WINDOWS = { platform: 'windows', shellVersion: '0.1.0', overlayTitlebar: true, windowControls: true };
const MACOS = { platform: 'macos', shellVersion: '0.1.0', overlayTitlebar: true, trafficLightInset: '5rem' };

/** Install a shell identity for one case; `afterEach` removes it. */
function withShell(identity: Record<string, unknown> | null) {
  // The shell's globals are not in the DOM's `window` type; one cast, at the seam.
  const shell = window as unknown as Shell;
  shell.__kabmoCall = async () => null;
  if (identity) shell.__kabmoDesktop = identity;
  else delete shell.__kabmoDesktop;
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
  const shell = window as unknown as Shell;
  delete shell.__kabmoDesktop;
  delete shell.__kabmoCall;
});

afterAll(() => {
  restoreDomGlobals();
});

async function settle(): Promise<void> {
  await server.waitForTopic(TOPIC_PANELS, (value) => value !== null);
  await server.waitForTopic(sessionTelemetryTopic(SESSION), (value) => value !== null);
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

/** Every control in the cluster, by its accessible name. */
function controlNames(): string[] {
  const names: string[] = [];
  for (const element of container.querySelectorAll('button, [title]')) {
    const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '';
    names.push(label.replace(/ \([^)]*\)$/, ''));
  }
  return names;
}

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
          showRightPanel: layout === 'desktop',
          onToggleRightPanel: () => {},
        }),
      }),
      container,
    );
  });
  await settle();
}

function unmount(): void {
  render(null, container);
  container.remove();
  container = undefined as unknown as HTMLElement;
}

/** A desktop shell window is allowed to be 720px — below the 768px breakpoint. */
const SHELL_MIN_WIDTH = 720;
const PHONE_WIDTH = 390;

describe('shell chrome', () => {
  test('the cluster marks itself no-drag on both layouts', async () => {
    for (const [layout, width] of [['desktop', 1024], ['mobile', PHONE_WIDTH]] as const) {
      await mount(layout, width);
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('titlebar-no-drag');
      unmount();
    }
  });

  test('a Windows shell draws the caption buttons on both layouts', async () => {
    withShell(WINDOWS);
    for (const [layout, width] of [['desktop', 1024], ['mobile', PHONE_WIDTH]] as const) {
      await mount(layout, width);
      const names = controlNames();
      expect(names).toContain('Minimize');
      expect(names).toContain('Maximize');
      expect(names).toContain('Close');
      unmount();
    }
  });

  /**
   * The case the bug was actually reported for: a Windows window at the shell's
   * own minimum width, which the app renders with the PHONE layout.
   */
  test('a Windows window at its minimum width still has its caption buttons', async () => {
    withShell(WINDOWS);
    await mount('mobile', SHELL_MIN_WIDTH);
    const names = controlNames();
    expect(names).toContain('Close');
    expect(names).toContain('Minimize');
  });

  test('a macOS shell draws no caption buttons of its own', async () => {
    withShell(MACOS);
    await mount('desktop', 1024);
    const names = controlNames();
    expect(names).not.toContain('Minimize');
    expect(names).not.toContain('Close');
  });

  /** A browser tab has no shell, so a caption button would be a dead control. */
  test('a browser draws no caption buttons', async () => {
    withShell(null);
    await mount('desktop', 1024);
    expect(controlNames()).not.toContain('Close');
  });

  /**
   * The caption buttons issue the shell's own verbs, from the phone layout too.
   *
   * A button that reaches the DOM but never calls the bridge is the same dead
   * control in a different disguise.
   */
  test('a caption click reaches the bridge from the phone layout', async () => {
    const calls: string[] = [];
    withShell(WINDOWS);
    ;(window as unknown as Shell).__kabmoCall = async (method) => {
      calls.push(method);
      return null;
    };
    await mount('mobile', PHONE_WIDTH);
    const close = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Close') as HTMLElement;
    expect(close).toBeTruthy();
    await act(async () => {
      close.click();
    });
    expect(calls).toContain('window_close');
  });
});
