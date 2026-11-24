/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The right-panel Usage view lists every provider that reports quota as its own
 * card.
 *
 * It used to render one provider behind a dropdown, so a second connected
 * provider was invisible until the reader opened the picker. The regressions
 * this pins are the shape of the surface — one card per provider, no provider
 * picker — and the filter that is ON by default: a provider with no quota
 * source is noise, a provider whose read FAILED is not, and the way back is
 * both the header toggle and the empty state's own link.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { UsagePanel } from '@/client/components/workspace/usage-panel/index';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
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

/**
 * Two providers with nothing to report (an untracked gateway, a wallet-only
 * provider whose rich report never arrived), one with a real window, and one
 * whose read failed — the four cases the hide filter has to tell apart.
 */
const mixedReport: UsageReport = {
  isMock: false,
  generatedAt: '2026-01-01T00:00:00.000Z',
  providers: [
    { id: 'gateway', name: 'Gateway', credentialSources: ['app DB'], tracked: false, limits: [] },
    {
      id: 'openai',
      name: 'OpenAI',
      credentialSources: ['models.yml'],
      tracked: true,
      limits: [{ id: 'weekly', label: 'Weekly', unit: 'percent', status: 'ok', usedFraction: 0.42 }],
    },
    {
      id: 'broken',
      name: 'Broken',
      credentialSources: ['environment'],
      tracked: true,
      limits: [],
      error: 'invalid or expired credential',
    },
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
  // The panel persists the filter through the settings snapshot; a test that
  // flipped it must not hand that state to the next one.
  primeKabmoSettings({});
});

afterAll(() => {
  restoreDomGlobals();
});

async function mount(source: UsageReport = report): Promise<void> {
  const resolver: TopicResolver = async () => source;
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
    if (url.includes('/api/settings/usage')) return json(source);
    return json({});
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(UsagePanel, { active: true }), container);
  });
  await server.waitForTopic(TOPIC_USAGE, (value) => value !== null);
}

/** The provider names the panel currently draws a card for, in order. */
function cardNames(): string[] {
  return [...container.querySelectorAll('section > header')].map((header) => header.textContent ?? '');
}

function filterToggle(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Hide providers without quota"]');
  if (!button) throw new Error('the Usage panel drew no hide-without-quota toggle');
  return button;
}

describe('right-panel Usage', () => {
  test('renders one card per provider that reports quota, and no provider picker', async () => {
    await mount(mixedReport);
    const headers = cardNames().join('|');
    expect(headers).toContain('OpenAI');
    // The failure is content, not emptiness: hiding it would silence the one
    // row that says why the provider is quiet.
    expect(headers).toContain('Broken');
    expect(headers).not.toContain('Gateway');
    expect(container.querySelector('[aria-haspopup="listbox"]')).toBeNull();
  });

  test('the filter starts ON, so a provider that reports nothing is not drawn', async () => {
    await mount(mixedReport);
    expect(cardNames()).toHaveLength(2);
    expect(filterToggle().getAttribute('aria-pressed')).toBe('true');
  });

  test('turning the filter off brings the empty providers back', async () => {
    await mount(mixedReport);
    await act(async () => filterToggle().click());

    const headers = cardNames().join('|');
    expect(headers).toContain('OpenAI');
    expect(headers).toContain('Broken');
    expect(headers).toContain('Gateway');
    expect(filterToggle().getAttribute('aria-pressed')).toBe('false');
  });

  test('an all-hidden panel says so and offers the way back', async () => {
    await mount();

    expect(cardNames()).toHaveLength(0);
    expect(container.textContent).toContain('report no quota usage');
    const showAll = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Show providers without quota'));
    expect(showAll).toBeDefined();

    await act(async () => showAll?.click());
    expect(cardNames()).toHaveLength(2);
    expect(filterToggle().getAttribute('aria-pressed')).toBe('false');
  });
});
