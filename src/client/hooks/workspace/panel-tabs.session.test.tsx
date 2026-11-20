/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tab strip's opening state: EMPTY, per session, and restored as itself.
 *
 * Three claims that the UI depends on and that a pure-function test cannot make,
 * because they are about the session slot:
 *
 * 1. **A session that has never opened a tab is on the HOME PAGE.** This is what
 *    makes the tab style different from the rail, whose default is a view: a
 *    column with no view still has to show something, while a strip's empty
 *    state is its catalog. The stored `layout.activeRightPanel` (`files`) must
 *    not seed a tab — that path is `useRightOpenRequest`.
 * 2. **Tabs are PER SESSION.** Two chats may be doing different work; carrying
 *    one chat's strip into another is the same mistake the sidebar's pending row
 *    made when it was derived from the active session.
 * 3. **The round trip is lossless**, including the home flag: closing every tab
 *    must come back as `home`, not as `active: null` on a strip that has tabs.
 *
 * Rendered against happy-dom with the real `SessionStateProvider`, and the store
 * is read directly for the persisted shape.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { usePanelTabs } from '@/client/hooks/workspace/panel-tabs';
import { getSessionState, getSessionValue, hydrateSession, setSessionKey } from '@/shared/lib/workspace/session-state/store';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const nativeFetch = Bun.fetch;

let container: HTMLElement;

/** What the probe last rendered, so a test can read the hook's whole shape. */
let seen: { tabs: readonly string[]; active: string | null; home: boolean } | null = null;
/** The probe's writer, so a test can drive an action from outside. */
let actions: { open: (id: string) => void; close: (id: string) => void; showHome: () => void } | null = null;

/** The right column's strip, rendered as the column renders it. */
function Probe() {
  const tabs = usePanelTabs('right', new Set(['files', 'git', 'todo']), null);
  seen = { tabs: tabs.tabs, active: tabs.active, home: tabs.home };
  actions = { open: tabs.open, close: tabs.close, showHome: tabs.showHome };
  return h('div', null, JSON.stringify(seen));
}

function mount(sessionId: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(h(SessionStateProvider, { sessionId, children: h(Probe, null) }), container);
  });
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // The stub stands in for the SERVER, and the server answers what it was
  // persisted — so the GET returns the session's own entry rather than `{}`.
  //
  // Returning `{}` made `loadSession` adopt an empty blob over the value
  // `hydrateSession` had just seeded, and `mount()` only awaits the effects of
  // the first commit: whether the clearing fetch had settled by the assertion
  // depended on the event loop's timing, not on the code. That passed locally
  // and failed 100% of the time in CI (both the Linux and the Windows leg, the
  // same single case), because the response landed before the first read there.
  target.fetch = async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? 'GET';
    const sessionId = String(input).split('/sessions/')[1]?.split('/')[0] ?? 'x';
    if (method === 'POST') return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(
      JSON.stringify({ sessionId, state: { ...(getSessionState(sessionId) ?? {}) } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
  target.fetch = nativeFetch;
});

afterEach(() => {
  render(null, container);
  container.remove();
  seen = null;
  actions = null;
});

describe('a session that never opened a tab', () => {
  test('starts on the home page with an empty strip, NOT on the stored right view', () => {
    hydrateSession('s-new', {});
    mount('s-new');
    expect(seen).toEqual({ tabs: [], active: null, home: true });
  });

  test('a stored `layout.activeRightPanel` does not seed a tab', () => {
    // The rail's default is `files`; the strip's default is nothing, and the
    // stored selection is not a request to open it.
    hydrateSession('s-rail', { 'layout.activeRightPanel': 'files' });
    mount('s-rail');
    expect(seen?.tabs).toEqual([]);
    expect(seen?.home).toBe(true);
  });
});

describe('tabs are per session', () => {
  test('two sessions keep different strips', () => {
    hydrateSession('s-a', { 'layout.rightPanelTabs': { tabs: ['files'], active: 'files', home: false } });
    hydrateSession('s-b', { 'layout.rightPanelTabs': { tabs: ['git', 'todo'], active: 'todo', home: false } });

    mount('s-a');
    expect(seen?.tabs).toEqual(['files']);
    render(null, container);
    container.remove();

    mount('s-b');
    expect(seen?.tabs).toEqual(['git', 'todo']);
    expect(seen?.active).toBe('todo');
  });

  test('a session with no blob is unaffected by another session that has one', () => {
    hydrateSession('s-has', { 'layout.rightPanelTabs': { tabs: ['files'], active: 'files', home: false } });
    hydrateSession('s-empty', {});
    mount('s-empty');
    expect(seen).toEqual({ tabs: [], active: null, home: true });
  });
});

describe('the round trip', () => {
  test('opening a tab persists under layout.rightPanelTabs', () => {
    hydrateSession('s-w', {});
    mount('s-w');
    act(() => actions!.open('git'));
    const stored = getSessionValue<{ tabs: string[]; active: string; home: boolean }>('s-w', 'layout.rightPanelTabs');
    expect(stored).toEqual({ tabs: ['git'], active: 'git', home: false });
  });

  test('closing the last tab persists the HOME page, not a bare null', () => {
    hydrateSession('s-c', {});
    mount('s-c');
    act(() => actions!.open('files'));
    act(() => actions!.close('files'));
    const stored = getSessionValue<{ tabs: string[]; active: string | null; home: boolean }>('s-c', 'layout.rightPanelTabs');
    expect(stored).toEqual({ tabs: [], active: null, home: true });
  });

  test('a stored home flag is restored as home even while tabs are open', () => {
    hydrateSession('s-h', {
      'layout.rightPanelTabs': { tabs: ['files', 'git'], active: 'git', home: true },
    });
    mount('s-h');
    expect(seen).toEqual({ tabs: ['files', 'git'], active: 'git', home: true });
  });

  test('the store key carries the layout prefix every other layout slot uses', () => {
    hydrateSession('s-k', {});
    mount('s-k');
    act(() => actions!.open('todo'));
    // One prefix for per-session UI, beside `layout.openedFiles` and
    // `layout.showRightPanel`; a key without it was the one inconsistency here.
    expect(getSessionValue('s-k', 'layout.rightPanelTabs')).not.toBeUndefined();
    expect(getSessionValue('s-k', 'rightPanelTabs')).toBeUndefined();
  });

  test('an id this build cannot draw is dropped, leaving the home page', () => {
    hydrateSession('s-x', {
      'layout.rightPanelTabs': { tabs: ['ghost'], active: 'ghost', home: false },
    });
    mount('s-x');
    expect(seen).toEqual({ tabs: [], active: null, home: true });
  });

  test('a corrupted blob is the empty page, not a crash', () => {
    hydrateSession('s-bad', { 'layout.rightPanelTabs': 'not-an-object' });
    mount('s-bad');
    expect(seen).toEqual({ tabs: [], active: null, home: true });
  });

  test('showHome keeps the strip and only changes the page', () => {
    hydrateSession('s-home', {
      'layout.rightPanelTabs': { tabs: ['files'], active: 'files', home: false },
    });
    mount('s-home');
    act(() => actions!.showHome());
    expect(seen).toEqual({ tabs: ['files'], active: 'files', home: true });
  });
});

/** Keeps the store honest about a write it never received. */
test('setSessionKey is the writer the hook goes through', () => {
  hydrateSession('s-direct', {});
  setSessionKey('s-direct', 'layout.rightPanelTabs', { tabs: ['git'], active: 'git', home: false });
  expect(getSessionValue('s-direct', 'layout.rightPanelTabs')).toEqual({
    tabs: ['git'],
    active: 'git',
    home: false,
  });
});
