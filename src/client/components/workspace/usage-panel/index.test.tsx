/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The right-panel Usage view lists EVERY provider as its own card.
 *
 * It used to render one provider behind a dropdown, so a second connected
 * provider was invisible until the reader opened the picker. The regression
 * this pins is the shape of the surface: one card per provider in the report,
 * and no provider picker at all.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { UsagePanel } from '@/client/components/workspace/usage-panel/index';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_USAGE } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import type { UsageReport } from '@/shared/types';

const nativeFetch = Bun.fetch;

const report: UsageReport = {
  isMock: false,
  generatedAt: '2026-01-01T00:00:00.000Z',
  providers: [
    { id: 'kenari', name: 'Kenari', credentialSources: ['models.yml'], tracked: true, limits: [] },
    { id: 'deepseek', name: 'DeepSeek', credentialSources: ['environment'], tracked: false, limits: [] },
  ],
};

let container: HTMLElement;
let server: RealtimeTestServer;

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

async function mount(): Promise<void> {
  const resolver: TopicResolver = async () => report;
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([[TOPIC_USAGE, resolver]]));
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
  (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    if (url.includes('/api/settings/usage/reset')) return json({ accounts: [] });
    if (url.includes('/api/settings/usage')) return json(report);
    return json({});
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(UsagePanel, { active: true }), container);
  });
  await server.waitForTopic(TOPIC_USAGE, (value) => value !== null);
}

describe('right-panel Usage', () => {
  test('renders one card per provider and no provider picker', async () => {
    await mount();
    const headers = [...container.querySelectorAll('section > header')].map((header) => header.textContent ?? '');
    expect(headers.some((text) => text.includes('Kenari'))).toBe(true);
    expect(headers.some((text) => text.includes('DeepSeek'))).toBe(true);
    expect(container.querySelector('[aria-haspopup="listbox"]')).toBeNull();
  });
});
