/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * 2. Folding a section must survive a remount AND a new chat. The state used
 *    to be a plain `useState`, so the reload the stale-list bug forced reset
 *    every fold. It then moved into the session UI slot
 *    (`chat.modelDropdownCollapsed`), which survived the reload but tied the
 *    fold to one chat: a new chat opened fully expanded. It is a preference
 *    about the list, so it now lives in `app_settings`
 *    (`omp_model_dropdown_collapsed`) beside the sidebar's width, and an
 *    install's per-session fold is adopted once on the next session load.
 *
 * The harness is a REAL realtime server: the picker dials it through the real
 * client, and the reload is driven by publishing a `models` delta — the same
 * signal a provider write produces — not by calling the hook directly.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ModelDropdown } from '@/client/components/workspace/model-dropdown/index';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import {
  LEGACY_SESSION_COLLAPSED_KEY,
  MODEL_PICKER_COLLAPSED_SETTING_KEY,
} from '@/shared/lib/models/picker-collapsed';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { invalidateModelsCache } from '@/shared/lib/models/client';
import { primeKabmoSettings, readKabmoSetting } from '@/shared/lib/settings/client';
import { TOPIC_MODELS } from '@/shared/lib/realtime/protocol';
import { forgetSession, getSessionValue } from '@/shared/lib/workspace/session-state/store';
import type { ModelsData } from '@/shared/types';

const SESSION = 'model-dropdown-refresh';
/** A second chat, to prove the fold is a preference rather than chat state. */
const OTHER_SESSION = 'model-dropdown-refresh-other';

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

/**
 * Serve `/api/models` from a payload the TEST swaps at the moment it writes.
 *
 * A positional queue assumes exactly one read per phase, and that assumption is
 * what made this file flaky: `useModelCatalog` fetches on mount AND again on the
 * realtime topic's first value, so on a runner where the socket's initial
 * publish lands AFTER the mount fetch resolves, the mount phase consumes TWO
 * entries — the second being the "after the write" payload — and the picker
 * clears its rows before the test publishes anything. Measured in CI: the panel
 * read `No models available` and the wait for `Alpha Model` timed out on Ubuntu
 * and on Windows while passing locally. The stub therefore holds ONE payload and
 * `serve()` replaces it; every read before the test's write sees the first one.
 */
function stubFetch(): {
  serve: (payload: unknown) => void;
  /** The blob `/api/sessions/:id/state` answers — the legacy fold lives here. */
  serveState: (state: Record<string, unknown>) => void;
} {
  let payload: unknown = null;
  let state: Record<string, unknown> = {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/models')) {
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/state')) {
      return new Response(JSON.stringify({ state }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return {
    serve: (next: unknown) => { payload = next; },
    serveState: (next: Record<string, unknown>) => { state = next; },
  };
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

async function mountPicker(sessionId?: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const picker = h(ModelDropdown, { onSelectModel: () => {} });
  const node = sessionId
    ? h(SessionStateProvider, { sessionId, children: picker })
    : picker;
  await act(async () => {
    render(node, host);
  });
  await flush();
  return host;
}

describe('model picker live updates', () => {
  // The catalog cache is MODULE state shared with every other suite in the
  // process, and `afterEach` only protects the tests that follow. A file that
  // read the catalog earlier — the real route, a stub, anything — leaves its
  // payload here, and the FIRST case then mounts against that stale list
  // instead of the stub this file installed: measured, `a reload carrying an
  // EMPTY model list` waited 3s for `Alpha Model` and read an empty panel on
  // both CI platforms while passing alone. Clear it before each case, not just
  // after.
  beforeEach(() => {
    invalidateModelsCache();
    // The settings snapshot is module state shared with every other suite: a
    // fold written here would otherwise be read back by the next file's mount.
    primeKabmoSettings({});
  });

  afterEach(async () => {
    await server?.stop();
    invalidateModelsCache();
    primeKabmoSettings({});
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
    forgetSession(OTHER_SESSION);
    restoreDomGlobals();
    globalThis.fetch = originalFetch;
  });

  test('a reload carrying an EMPTY model list clears the picker', async () => {
    server = await startRealtimeTestServer(new Map([[TOPIC_MODELS, async () => WITH_MODELS]]));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    const models = stubFetch();
    models.serve(WITH_MODELS);

    container = await mountPicker();
    trigger(container).click();
    const panelText = () => container.textContent ?? '';
    // The rows arrive over the realtime socket, so this waits for the CONDITION
    // rather than for a duration: a fixed flush is enough on a fast runner and
    // is not on a Windows one (measured: the panel still read "No models
    // available" 80ms after the click).
    await waitForDom(() => panelText().includes('Alpha Model'));
    expect(panelText()).toContain('Beta Model');

    // The app clears its client cache after a provider write, then the topic
    // delta drives the reload — mirrored here in that exact order. The payload
    // is swapped BEFORE the signal so the reload cannot read the old one.
    models.serve(EMPTY_MODELS);
    invalidateModelsCache();
    server.publish(TOPIC_MODELS, EMPTY_MODELS);

    await waitForDom(() => panelText().includes('No models available'));
    expect(panelText()).not.toContain('Alpha Model');
    expect(panelText()).not.toContain('Beta Model');
  });

  test('a FAILED read (modelError) keeps the previous list', async () => {
    server = await startRealtimeTestServer(new Map([[TOPIC_MODELS, async () => WITH_MODELS]]));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    const models = stubFetch();
    models.serve(WITH_MODELS);

    container = await mountPicker();
    trigger(container).click();
    const panelText = () => container.textContent ?? '';
    await waitForDom(() => panelText().includes('Alpha Model'));

    models.serve(ERROR_MODELS);
    invalidateModelsCache();
    server.publish(TOPIC_MODELS, ERROR_MODELS);

    // The failure must NOT blank the rail — wait a beat and assert the rows
    // are still there (and the failure is not republished as empty).
    await flush(15, 15);
    expect(panelText()).toContain('Alpha Model');
    expect(panelText()).not.toContain('No models available');
  });

  test('a folded section is remembered across remounts and new chats', async () => {
    server = await startRealtimeTestServer(new Map([[TOPIC_MODELS, async () => WITH_MODELS]]));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    const models = stubFetch();
    models.serve(WITH_MODELS);

    container = await mountPicker(SESSION);
    trigger(container).click();
    const panelText = () => container.textContent ?? '';
    await waitForDom(() => panelText().includes('Alpha Model'));

    // Collapse the FIRST provider section. The group key is the provider name
    // upper-cased (`buildPickerGroups`), and the header renders that key.
    const header = findButton(container, 'ALPHA');
    expect(header).not.toBeNull();
    await act(async () => {
      header!.click();
    });
    expect(readKabmoSetting<Record<string, boolean>>(MODEL_PICKER_COLLAPSED_SETTING_KEY)).toEqual({ ALPHA: true });
    expect(panelText()).not.toContain('Alpha Model');

    // A fresh mount (as after a reload) restores the fold.
    render(null, container);
    container.remove();
    container = await mountPicker(SESSION);
    trigger(container).click();
    await waitForDom(() => panelText().includes('Beta Model'));
    expect(panelText()).not.toContain('Alpha Model');

    // And so does a DIFFERENT chat. The fold is a preference about the list,
    // not part of the conversation it was made in — a per-session slot made
    // every new chat open fully expanded.
    render(null, container);
    container.remove();
    container = await mountPicker(OTHER_SESSION);
    trigger(container).click();
    await waitForDom(() => panelText().includes('Beta Model'));
    expect(panelText()).not.toContain('Alpha Model');
  });

  test('a fold an older build stored per session is adopted once', async () => {
    server = await startRealtimeTestServer(new Map([[TOPIC_MODELS, async () => WITH_MODELS]]));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    const models = stubFetch();
    models.serve(WITH_MODELS);
    models.serveState({ [LEGACY_SESSION_COLLAPSED_KEY]: { ALPHA: true } });

    container = await mountPicker(SESSION);
    trigger(container).click();
    const panelText = () => container.textContent ?? '';
    await waitForDom(() => panelText().includes('Beta Model') && !panelText().includes('Alpha Model'));
    expect(readKabmoSetting<Record<string, boolean>>(MODEL_PICKER_COLLAPSED_SETTING_KEY)).toEqual({ ALPHA: true });
    // The slot is retired, so the blob stops holding a second answer.
    expect(getSessionValue(SESSION, LEGACY_SESSION_COLLAPSED_KEY)).toBeUndefined();
  });
});