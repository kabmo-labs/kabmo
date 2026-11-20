/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useUserBrowser`: tabs, their own histories, and the restore path.
 *
 * The failure each case pins is one a user would report as "the browser lost my
 * work": Back in tab 2 landing on tab 1's page, a reloaded panel coming back
 * blank, a closed active tab leaving no page, and a typed address vanishing
 * when no tab exists yet.
 *
 * Rendered against a real `SessionStateProvider` (the hook reads and persists
 * through it), with `fetch` stubbed so the provider has a blob to load.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { useUserBrowser, type UseUserBrowserResult } from '@/client/hooks/browser/use-user-browser';
import { flushSession, forgetSession } from '@/shared/lib/workspace/session-state/store';
import { MAX_USER_BROWSER_TABS } from '@/shared/lib/browser/user-tabs';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent',
] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const nativeFetch = Bun.fetch;

let container: HTMLElement | undefined;
let latest: UseUserBrowserResult | undefined;
/** The blob the stubbed server answers a GET with, per session id. */
let stored = new Map<string, Record<string, unknown>>();
/** Every POST body the persist path sent, so the write itself is asserted. */
let posts: { sessionId: string; state: Record<string, unknown> }[] = [];

function Probe() {
  latest = useUserBrowser();
  return null;
}

const api = (): UseUserBrowserResult => {
  if (!latest) throw new Error('hook not rendered');
  return latest;
};

async function mount(sessionId: string): Promise<void> {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(SessionStateProvider, { sessionId, children: h(Probe, null) }), container!);
  });
  for (let i = 0; i < 12; i += 1) await act(async () => {});
}

async function run(action: () => void): Promise<void> {
  await act(async () => {
    action();
  });
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const url = String(input);
    const sessionId = decodeURIComponent(url.split('/api/sessions/')[1]?.split('/')[0] ?? '');
    if (init?.method === 'POST') {
      posts.push({ sessionId, state: JSON.parse(String(init.body)).state as Record<string, unknown> });
    }
    const body = init?.method === 'POST' ? { success: true } : { sessionId, state: stored.get(sessionId) ?? {} };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  target.fetch = nativeFetch;
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  container = undefined;
  latest = undefined;
  stored = new Map();
  posts = [];
});

describe('useUserBrowser tabs', () => {
  test('a fresh session opens one blank tab, and a typed address becomes its page', async () => {
    await mount('tabs-fresh');
    expect(api().tabs.length).toBe(1);
    expect(api().url).toBe('');
    expect(api().activeTabId).toBe(api().tabs[0]!.id);

    await run(() => api().submit('example.com'));
    expect(api().url).toBe('https://example.com/');
    expect(api().tabs[0]!.frameKey).toBe(1);
    forgetSession('tabs-fresh');
  });

  test('each tab owns its history: Back never leaves the tab it was pressed in', async () => {
    await mount('tabs-history');
    await run(() => api().submit('https://a.test/'));
    await run(() => api().submit('https://b.test/'));
    const firstTab = api().activeTabId!;

    await run(() => api().openTab());
    expect(api().tabs.length).toBe(2);
    expect(api().url).toBe('');
    await run(() => api().submit('https://c.test/'));

    // The second tab is on its own page, with nothing behind it.
    expect(api().url).toBe('https://c.test/');
    expect(api().canGoBack).toBe(false);

    await run(() => api().selectTab(firstTab));
    expect(api().url).toBe('https://b.test/');
    expect(api().canGoBack).toBe(true);
    await run(() => api().goBack());
    expect(api().url).toBe('https://a.test/');
    // Back stayed inside the first tab: the second is untouched.
    const second = api().tabs.find((tab) => tab.id !== firstTab)!;
    expect(second.history).toEqual(['https://c.test/']);
    forgetSession('tabs-history');
  });

  test('a switch repoints the address field at the tab it activates', async () => {
    await mount('tabs-input');
    await run(() => api().submit('https://a.test/'));
    const firstTab = api().activeTabId!;
    await run(() => api().openTab());
    expect(api().input).toBe('');
    await run(() => api().selectTab(firstTab));
    expect(api().input).toBe('https://a.test/');
    forgetSession('tabs-input');
  });

  test('closing the active tab keeps a page on screen, and the last close leaves a fresh tab', async () => {
    await mount('tabs-close');
    await run(() => api().submit('https://a.test/'));
    await run(() => api().openTab());
    await run(() => api().submit('https://b.test/'));
    const [first, second] = api().tabs;

    await run(() => api().closeTab(second!.id));
    expect(api().tabs.length).toBe(1);
    expect(api().activeTabId).toBe(first!.id);
    expect(api().url).toBe('https://a.test/');

    await run(() => api().closeTab(first!.id));
    expect(api().tabs.length).toBe(1);
    expect(api().url).toBe('');
    expect(api().tabs[0]!.id).not.toBe(first!.id);
    forgetSession('tabs-close');
  });

  test('a reloaded panel restores the tabs and the active one', async () => {
    stored.set('tabs-restore', {
      'userBrowser.tabs': [
        { id: 'one', history: ['https://one.test/'], index: 0, frameKey: 0 },
        { id: 'two', history: ['https://two.test/'], index: 0, frameKey: 3 },
      ],
      'userBrowser.activeTabId': 'one',
      'userBrowser.inputUrl': 'https://one.test/',
    });

    await mount('tabs-restore');
    expect(api().tabs.map((tab) => tab.id)).toEqual(['one', 'two']);
    expect(api().url).toBe('https://one.test/');
    expect(api().activeTabId).toBe('one');
    forgetSession('tabs-restore');
  });

  test('a session stored before tabs existed gets its history migrated into one tab', async () => {
    stored.set('tabs-legacy', {
      'userBrowser.history': ['https://old.test/', 'https://older.test/'],
      'userBrowser.historyIndex': 1,
    });

    await mount('tabs-legacy');
    expect(api().tabs.length).toBe(1);
    expect(api().url).toBe('https://older.test/');
    expect(api().canGoBack).toBe(true);
    await run(() => api().goBack());
    expect(api().url).toBe('https://old.test/');
    forgetSession('tabs-legacy');
  });

  test('a stale stored active id falls back to a real tab instead of an empty strip', async () => {
    stored.set('tabs-stale', {
      'userBrowser.tabs': [{ id: 'real', history: ['https://real.test/'], index: 0 }],
      'userBrowser.activeTabId': 'deleted-elsewhere',
    });

    await mount('tabs-stale');
    expect(api().activeTabId).toBe('real');
    expect(api().url).toBe('https://real.test/');
    forgetSession('tabs-stale');
  });

  test('the tab cap disables opening rather than silently dropping a tab', async () => {
    await mount('tabs-cap');
    for (let i = 1; i < MAX_USER_BROWSER_TABS; i += 1) await run(() => api().openTab());
    expect(api().tabs.length).toBe(MAX_USER_BROWSER_TABS);
    expect(api().canOpenTab).toBe(false);
    await run(() => api().openTab());
    expect(api().tabs.length).toBe(MAX_USER_BROWSER_TABS);
    forgetSession('tabs-cap');
  });

  test('a reload request bumps only the active tab', async () => {
    await mount('tabs-reload');
    await run(() => api().submit('https://a.test/'));
    const first = api().tabs[0]!;
    await run(() => api().openTab());
    await run(() => api().submit('https://b.test/'));
    const second = api().tabs[1]!;
    expect(second.frameKey).toBe(1);

    await run(() => api().reload());
    expect(api().tabs[1]!.frameKey).toBe(2);
    expect(api().tabs[0]!.frameKey).toBe(first.frameKey);
    forgetSession('tabs-reload');
  });

  test('an invalid address is reported and leaves the tab untouched', async () => {
    await mount('tabs-error');
    await run(() => api().submit('javascript:alert(1)'));
    expect(api().error).toBeTruthy();
    expect(api().url).toBe('');
    forgetSession('tabs-error');
  });

  test('loading is tracked per tab, so a background load cannot spin the visible bar', async () => {
    await mount('tabs-loading');
    await run(() => api().submit('https://a.test/'));
    expect(api().loading).toBe(true);
    const first = api().activeTabId!;
    await run(() => api().openTab());
    expect(api().loading).toBe(false);
    await run(() => api().selectTab(first));
    expect(api().loading).toBe(true);
    await run(() => api().markLoaded(first));
    expect(api().loading).toBe(false);
    forgetSession('tabs-loading');
  });

  test('the tab list is persisted under the session, so a reopened panel restores it', async () => {
    await mount('tabs-persist');
    await run(() => api().submit('https://persist.test/'));
    await act(async () => {
      await flushSession('tabs-persist');
    });

    const write = posts.find((post) => post.sessionId === 'tabs-persist');
    const written = write?.state['userBrowser.tabs'] as { history: string[] }[] | undefined;
    expect(written?.[0]?.history).toEqual(['https://persist.test/']);
    expect(write?.state['userBrowser.activeTabId']).toBe(api().activeTabId);
    forgetSession('tabs-persist');
  });
});
