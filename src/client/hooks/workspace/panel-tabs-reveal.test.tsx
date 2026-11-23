/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Revealing a tab-style column must show a VIEW, and only a reveal counts.
 *
 * The reported defect: with `rightPanelNav: tabs`, a fresh session put the side
 * away and the navbar's toggle brought back the catalog card grid (`Panel
 * kanan`) — while the Stats navbar readout, which names a panel, opened its
 * view. Two clicks that both promise "show me the panel" gave two different
 * answers, and the one the user pressed second looked broken.
 *
 * The cases below pin both halves of the rule: the EDGE (closed → open, on the
 * home page, with a drawable view) and the four things that must NOT count — a
 * column that mounts open, a column already showing a tab, a rail column, and a
 * view this build cannot draw.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { usePanelTabs } from '@/client/hooks/workspace/panel-tabs';
import {
  revealTabId,
  useRevealEdge,
  useRevealPanelTab,
  useRevealSignal,
  type RevealTabInput,
} from '@/client/hooks/workspace/panel-tabs-reveal';
import {
  getSessionState,
  getSessionValue,
  hydrateSession,
  resetSessionStateStore,
} from '@/shared/lib/workspace/session-state/store';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const nativeFetch = Bun.fetch;

let container: HTMLElement;

/** The column's props, driven from outside by the hook cases. */
let column = { open: false, storedView: 'files' as string | null, enabled: true, known: new Set(['files', 'git', 'todo']) };
/** What the probe last rendered. */
let seen: { tabs: readonly string[]; active: string | null; home: boolean; chosenHome: boolean } | null = null;
/** The probe's writer, so a test can close a tab the way the strip does. */
let actions: { open: (id: string) => void; close: (id: string) => void } | null = null;

function Probe() {
  const tabs = usePanelTabs('right', column.known, null);
  useRevealPanelTab({
    enabled: column.enabled,
    revealed: useRevealEdge(column.open),
    storedView: column.storedView,
    home: tabs.home,
    chosenHome: tabs.chosenHome,
    openTab: tabs.open,
    known: column.known,
  });
  seen = { tabs: tabs.tabs, active: tabs.active, home: tabs.home, chosenHome: tabs.chosenHome };
  actions = { open: tabs.open, close: tabs.close };
  return h('div', null, JSON.stringify(seen));
}

function mount(sessionId: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(h(SessionStateProvider, { sessionId, children: h(Probe, null) }), container);
  });
}

/** Apply a prop change the way the layout would, then let the effects land. */
async function rerender() {
  await act(async () => {
    render(h(SessionStateProvider, { sessionId: currentSession, children: h(Probe, null) }), container);
  });
  await act(async () => {});
}

let currentSession = '';

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // The stub answers what was persisted, so a load landing mid-test cannot
  // adopt an empty blob over the value `hydrateSession` seeded.
  target.fetch = async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? 'GET';
    const sessionId = String(input).split('/sessions/')[1]?.split('/')[0] ?? 'x';
    if (method === 'POST') return new Response(JSON.stringify({ success: true }), { status: 200 });
    return new Response(JSON.stringify({ sessionId, state: { ...(getSessionState(sessionId) ?? {}) } }), { status: 200 });
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

beforeEach(() => {
  // The store is a module singleton: a tab left by one case would seed the next.
  resetSessionStateStore();
  column = { open: false, storedView: 'files', enabled: true, known: new Set(['files', 'git', 'todo']) };
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  seen = null;
  actions = null;
});

/** The rule, as data: only the reveal edge on a home page with a view the session picked. */
describe('revealTabId', () => {
  const base: RevealTabInput = {
    revealed: true,
    home: true,
    chosenHome: false,
    storedView: 'files',
    known: new Set(['files', 'git']),
    enabled: true,
  };

  test('a reveal on the home page opens the stored view', () => {
    expect(revealTabId(base)).toBe('files');
  });

  test('a home page the user closed a tab down to is not reopened', () => {
    // The reported defect: closing the right panel's tab and then toggling the
    // panel brought that tab back. A close is an answer; the reveal must not
    // read the resulting catalog as "nothing was ever open".
    expect(revealTabId({ ...base, chosenHome: true })).toBeNull();
  });

  test('a column that was already open is not a reveal', () => {
    // The `+` control puts the column on its catalog ON PURPOSE; a rule keyed on
    // "open and on the home page" would undo that on the next render.
    expect(revealTabId({ ...base, revealed: false })).toBeNull();
  });

  test('a column already showing a tab needs nothing opened', () => {
    expect(revealTabId({ ...base, home: false })).toBeNull();
  });

  test('a rail column has no home page to leave', () => {
    expect(revealTabId({ ...base, enabled: false })).toBeNull();
  });

  test('a view this build cannot draw is not opened', () => {
    // Opening it would write an id `visiblePanelTabs` filters back out — a write
    // loop disguised as a sync.
    expect(revealTabId({ ...base, storedView: 'ghost' })).toBeNull();
  });

  test('a session that never picked a view keeps its catalog', () => {
    // The reported defect: a new chat's right drawer showed a `Files` tab on
    // both layouts. The resolved fallback is not a pick.
    expect(revealTabId({ ...base, storedView: null })).toBeNull();
  });
});

/**
 * A phone drawer unmounts on close, so its mount is also what a screen change for
 * any other reason produces. The counter the header bumps is what tells it apart.
 */
describe('useRevealSignal', () => {
  test('the first value is not a reveal, a bump is', async () => {
    const seen: boolean[] = [];
    function ProbeSignal({ signal }: { signal: number }) {
      seen.push(useRevealSignal(signal));
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      render(h(ProbeSignal, { signal: 0 }), host);
    });
    await act(async () => {
      render(h(ProbeSignal, { signal: 1 }), host);
    });
    // A CLEARED counter is the layout saying "nobody asked for a reveal here" —
    // the named open that clears it (the Stats readout) is what the drawer opens
    // on, so the drop must not read as a gesture of its own.
    await act(async () => {
      render(h(ProbeSignal, { signal: 0 }), host);
    });
    render(null, host);
    host.remove();
    expect(seen).toEqual([false, true, false]);
  });
});

describe('the column, mounted and toggled', () => {
  test('a column that MOUNTS open stays on its home page', async () => {
    // A restored selection is not a request (`useRightOpenRequest` owns that),
    // and a fresh tab-style install must not open Files by itself.
    currentSession = 'reveal-mount-open';
    hydrateSession(currentSession, {});
    column.open = true;
    mount(currentSession);
    expect(seen).toEqual({ tabs: [], active: null, home: true, chosenHome: false });
  });

  test('a session that never picked a view stays on its catalog', async () => {
    // A fresh chat: the empty strip is its home page. Revealing the panel must
    // not turn the `files` fallback into a tab — the reported defect on both
    // layouts.
    currentSession = 'reveal-edge';
    hydrateSession(currentSession, {});
    column.storedView = null;
    mount(currentSession);
    expect(seen).toEqual({ tabs: [], active: null, home: true, chosenHome: false });

    column.open = true;
    await rerender();

    expect(seen).toEqual({ tabs: [], active: null, home: true, chosenHome: false });
    expect(getSessionValue(currentSession, 'layout.rightPanelTabs')).toBeUndefined();
  });

  test('a tab closed by the user stays closed across a toggle', async () => {
    // The reported defect: closing the right panel's last tab and toggling the
    // panel back brought that tab out of the catalog, because the empty strip
    // was read as "this session never opened one".
    currentSession = 'reveal-closed';
    hydrateSession(currentSession, {});
    mount(currentSession);

    column.open = true;
    await rerender();
    expect(seen?.tabs).toEqual(['files']);

    act(() => actions!.close('files'));
    expect(seen).toEqual({ tabs: [], active: null, home: true, chosenHome: true });

    column.open = false;
    await rerender();
    column.open = true;
    await rerender();

    expect(seen).toEqual({ tabs: [], active: null, home: true, chosenHome: true });
  });

  test('a column that already had a tab is only revealed, never re-opened', async () => {
    currentSession = 'reveal-existing';
    hydrateSession(currentSession, { 'layout.rightPanelTabs': { tabs: ['git'], active: 'git', home: false } });
    column.storedView = 'git';
    mount(currentSession);
    expect(seen?.tabs).toEqual(['git']);

    column.open = true;
    await rerender();

    // Nothing appended, nothing selected differently: revealing a column that
    // already shows a view is the whole of the click.
    expect(seen).toEqual({ tabs: ['git'], active: 'git', home: false, chosenHome: false });
  });

  test('a rail column ignores the toggle entirely', async () => {
    currentSession = 'reveal-rail';
    hydrateSession(currentSession, {});
    column.enabled = false;
    mount(currentSession);

    column.open = true;
    await rerender();

    expect(seen).toEqual({ tabs: [], active: null, home: true, chosenHome: false });
  });
});
