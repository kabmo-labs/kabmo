/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The context-usage control both headers draw.
 *
 * Three properties are invisible to a markup check and each was a bug first:
 *
 * - The ring FILLS clockwise with the share of the window in use — a ring that
 *   renders its track and its arc in the same colour looks empty at 90%, so the
 *   arc's own class and its `stroke-dashoffset` are both asserted.
 * - The colour is a BAND, and the boundaries belong to the worse band (50 is
 *   already amber, 60 already red). A table that shifts by one draws the same
 *   shape in the neighbouring colour, which no visual review catches.
 * - The popover reads the SESSION's telemetry, so a session with no turn says
 *   so rather than printing a row of zeros as if they were measurements.
 *
 * Driven through a real realtime server (the topic IS the source) with the HTTP
 * fallback stubbed, rendered with `h()` against happy-dom.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ContextUsageButton } from '@/client/components/common/context-usage-button';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { invalidateModelsCache } from '@/shared/lib/models/client';
import { sessionTelemetryTopic } from '@/shared/lib/realtime/protocol';
import { contextRingGeometry } from '@/shared/lib/chat/context/usage';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import type { SessionContextTelemetry } from '@/shared/types/context';

const SESSION = 'session-context-ring';
const TOPIC = sessionTelemetryTopic(SESSION);
const nativeFetch = Bun.fetch;

let container: HTMLElement;
let server: RealtimeTestServer;
/** What the topic resolver answers; each case sets it before mounting. */
let telemetry: SessionContextTelemetry;

function telemetryAt(percent: number): SessionContextTelemetry {
  return {
    sessionId: SESSION,
    sessionTitle: 'Ring',
    modelId: 'kenari/deepseek-v4-1-flash',
    modelName: 'deepseek-v4-1-flash',
    timestamp: 'today',
    contextUsed: percent * 1_000,
    contextLimit: 100_000,
    contextPercent: percent,
    messagesCount: 4,
    userCount: 1,
    assistantCount: 3,
    totalCost: 0.02,
    costFormatted: '$0.02',
    cacheHitAverage: 91.5,
    lastMessage: { input: 10, output: 4, reasoning: 0, cacheRead: 2, cacheWrite: 0, cacheHitPercent: 16.6 },
    distribution: { userTokens: 1, userPercent: 25, assistantTokens: 1, assistantPercent: 25, toolTokens: 1, toolPercent: 25, otherTokens: 1, otherPercent: 25 },
    rawMessages: [],
  };
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  resetRealtimeClient();
  server?.stop();
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

/** The arc is the ring's SECOND circle: the track is drawn first. */
function arc(): SVGElement {
  const circles = container.querySelectorAll('svg circle');
  return circles[1] as unknown as SVGElement;
}

function trigger(): HTMLElement {
  return container.querySelector('button[aria-label="Context usage"]') as HTMLElement;
}

async function mount(snapshot: SessionContextTelemetry): Promise<void> {
  telemetry = snapshot;
  // `/api/models` is cached for 60s in MODULE state, shared by every suite in
  // this process: a case here would otherwise read another file's empty catalog
  // and print the raw model slug.
  invalidateModelsCache();
  const resolver: TopicResolver = async () => telemetry;
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([[TOPIC, resolver]]));
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
  (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;
  // The HTTP route is only a fallback (MOCK mode, an in-memory session); it
  // answers the same snapshot so a case never depends on which source won.
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    if (url.includes('/api/telemetry/context')) return json({ telemetry });
    // The catalog resolves the display names the popover prints; a raw slug is
    // the fallback, so a stub with no list would still pass a slug assertion.
    if (url.includes('/api/models')) {
      return json({
        modelList: [{ id: 'deepseek-v4-1-flash', name: 'DeepSeek V4-1-Flash' }],
        connectedProviders: [{ id: 'kenari', name: 'Kenari', disabled: false }],
      });
    }
    return json({});
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(ContextUsageButton, { sessionId: SESSION }), container);
  });
  await server.waitForTopic(TOPIC, (value) => value !== null);
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

describe('ContextUsageButton', () => {
  test('fills the ring with the share in use, clockwise from the top', async () => {
    await mount(telemetryAt(42));

    const { circumference, dashOffset } = contextRingGeometry(42, 18, 2);
    expect(Number(arc().getAttribute('stroke-dasharray'))).toBeCloseTo(circumference);
    expect(Number(arc().getAttribute('stroke-dashoffset'))).toBeCloseTo(dashOffset);
    // The arc starts at three o'clock on an SVG circle; the rotation is what
    // makes the fill read clockwise from twelve — around the ring's CENTRE, not
    // the viewBox origin.
    expect(arc().getAttribute('transform')).toBe('rotate(-90 9 9)');
  });

  test('draws the band the share falls in', async () => {
    await mount(telemetryAt(42));
    expect(arc().getAttribute('class')).toContain('text-success');
    expect(trigger().getAttribute('title')).toContain('42%');

    render(null, container);
    resetRealtimeClient();
    server.stop();
    await mount(telemetryAt(55));
    expect(arc().getAttribute('class')).toContain('text-warning');

    render(null, container);
    resetRealtimeClient();
    server.stop();
    await mount(telemetryAt(72));
    expect(arc().getAttribute('class')).toContain('text-error');
  });

  test('the popover prints the session numbers, and Escape closes it', async () => {
    await mount(telemetryAt(42));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      trigger().click();
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Kenari');
    expect(dialog?.textContent).toContain('DeepSeek V4-1-Flash');
    expect(dialog?.textContent).toContain('42%');
    expect(dialog?.textContent).toContain('$0.02');

    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test('a session with no turn says so instead of printing zeros', async () => {
    await mount({ ...telemetryAt(0), messagesCount: 0 });
    expect(trigger().getAttribute('title')).toBe('Context usage — session not started');
    await act(async () => {
      trigger().click();
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Session not started');
    expect(dialog?.textContent).not.toContain('Cost:');
  });
});
