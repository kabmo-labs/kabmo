/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The model picker's live-update contract.
 *
 * Two regressions pinned here, both found in a real browser against a real
 * server:
 *
 * 1. A topic-triggered reload with an EMPTY model list must clear the picker.
 *    `load()` used to require `modelList.length > 0`, so disabling/removing the
 *    LAST provider refreshed `GET /api/models` (which honestly answered `[]`)
 *    and then ignored the answer — the dropdown kept showing models that no
 *    longer exist until a full page reload. The `modelError` half pins the
 *    mirror rule: a FAILED read still keeps the previous list, so the picker
 *    does not flash the empty state over an omp registry hiccup.
 *
 * 2. Collapsing a section must survive a remount. The state used to be a plain
 *    `useState`, so the reload the stale-list bug forced reset every collapse.
 *    It is now persisted in the session UI slot (`chat.modelDropdownCollapsed`).
 *
 * The harness is a REAL realtime server: the picker dials it through the real
 * client, and the reload is driven by publishing a `models` delta — the same
 * signal a provider write produces — not by calling the hook directly.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ModelDropdown } from '@/client/components/workspace/model-dropdown/index';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import {
  MODEL_DROPDOWN_COLLAPSED_KEY,
} from '@/client/components/workspace/model-dropdown/collapsed';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { invalidateModelsCache } from '@/shared/lib/models/client';
import { TOPIC_MODELS } from '@/shared/lib/realtime/protocol';
import { forgetSession, getSessionValue } from '@/shared/lib/workspace/session-state/store';
import type { ModelsData } from '@/shared/types';

const SESSION = 'model-dropdown-refresh';

const WITH_MODELS: ModelsData = {
  models: { alpha: 'Alpha Model', beta: 'Beta Model' },
  modelList: [
    { id: 'alpha-model', name: 'Alpha Model', provider: 'alpha', thinkingLevels: ['off', 'low'] },
    { id: 'beta-model', name: 'Beta Model', provider: 'beta', thinkingLevels: ['off', 'low'] },
  ],
  defaultModel: null,
  thinkingLevels: {},
};

const EMPTY_MODELS: ModelsData = { models: {}, modelList: [], defaultModel: null, thinkingLevels: {} };

/** A FAILED read: the route answers `modelList: []` WITH `modelError`. */
const ERROR_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  modelError: 'Model list is temporarily unavailable. Check your configuration and try again.',
};

const originalFetch = globalThis.fetch;

function stubFetch(modelsResponses: unknown[]): void {
  let modelsCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/models')) {
      const payload = modelsResponses[Math.min(modelsCalls, modelsResponses.length - 1)];
      modelsCalls += 1;
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/state')) {
      return new Response(JSON.stringify({ state: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function flush(times = 12, ms = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await sleep(ms);
    });
  }
}

async function waitForDom(assertion: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await act(async () => {
      await sleep(15);
    });
  }
  throw new Error('waitForDom timeout');
}

function trigger(el: HTMLElement): HTMLButtonElement {
  const found = Array.from(el.querySelectorAll('button')).find(
    (b) => b.getAttribute('title') === 'Select a model',
  );
  if (!found) throw new Error('no model-dropdown trigger');
  return found as HTMLButtonElement;
}

function findButton(el: HTMLElement, text: string): HTMLButtonElement | null {
  return (Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text)) ??
    null) as HTMLButtonElement | null;
}

let server: RealtimeTestServer;
let container: HTMLElement;

async function mountPicker(withProvider = false): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const picker = h(ModelDropdown, { onSelectModel: () => {} });
  const node = withProvider
    ? h(SessionStateProvider, { sessionId: SESSION, children: picker })
    : picker;
  await act(async () => {
    render(node, host);
  });
  await flush();
  return host;
}

describe('model picker live updates', () => {
  afterEach(async () => {
    await server?.stop();
    invalidateModelsCache();
    if (container) {
      // A real unmount, not `remove()`: the picker's realtime subscription
      // must be released or its late socket-close events re-render into a
      // torn-down `document`.
      render(null, container);
      container.remove();
    }
    container = null as never;
    if (document.body) document.body.innerHTML = '';
    forgetSession(SESSION);
    restoreDomGlobals();
    globalThis.fetch = originalFetch;
  });

  test('a reload carrying an EMPTY model list clears the picker', async () => {
    server = await startRealtimeTestServer(new Map([[TOPIC_MODELS, async () => WITH_MODELS]]));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    stubFetch([WITH_MODELS, EMPTY_MODELS]);

    container = await mountPicker();
    trigger(container).click();
    await flush(8, 10);
    const panelText = () => container.textContent ?? '';
    expect(panelText()).toContain('Alpha Model');
    expect(panelText()).toContain('Beta Model');

    // The app clears its client cache after a provider write, then the topic
    // delta drives the reload — mirrored here in that exact order.
    invalidateModelsCache();
    server.publish(TOPIC_MODELS, EMPTY_MODELS);

    await waitForDom(() => panelText().includes('No models available'));
    expect(panelText()).not.toContain('Alpha Model');
    expect(panelText()).not.toContain('Beta Model');
  });

  test('a FAILED read (modelError) keeps the previous list', async () => {
    server = await startRealtimeTestServer(new Map([[TOPIC_MODELS, async () => WITH_MODELS]]));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    stubFetch([WITH_MODELS, ERROR_MODELS]);

    container = await mountPicker();
    trigger(container).click();
    await flush(8, 10);
    const panelText = () => container.textContent ?? '';
    expect(panelText()).toContain('Alpha Model');

    invalidateModelsCache();
    server.publish(TOPIC_MODELS, ERROR_MODELS);

    // The failure must NOT blank the rail — wait a beat and assert the rows
    // are still there (and the failure is not republished as empty).
    await flush(15, 15);
    expect(panelText()).toContain('Alpha Model');
    expect(panelText()).not.toContain('No models available');
  });

  test('a collapsed section is persisted and restored on remount', async () => {
    server = await startRealtimeTestServer(new Map([[TOPIC_MODELS, async () => WITH_MODELS]]));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    stubFetch([WITH_MODELS]);

    container = await mountPicker(true);
    trigger(container).click();
    await flush(8, 10);
    const panelText = () => container.textContent ?? '';

    // Collapse the FIRST provider section. The group key is the provider name
    // upper-cased (`buildPickerGroups`), and the header renders that key.
    const header = findButton(container, 'ALPHA');
    expect(header).not.toBeNull();
    await act(async () => {
      header!.click();
    });
    expect(getSessionValue<Record<string, boolean>>(SESSION, MODEL_DROPDOWN_COLLAPSED_KEY)).toEqual({ ALPHA: true });
    expect(panelText()).not.toContain('Alpha Model');

    // A fresh mount (as after a reload) restores the collapse from the store.
    render(null, container);
    container.remove();
    container = await mountPicker(true);
    trigger(container).click();
    await flush(8, 10);
    expect(panelText()).toContain('Beta Model');
    expect(panelText()).not.toContain('Alpha Model');
  });
});