/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's two drawers as SCREENS.
 *
 * A drawer here is not a column: the right one unmounts when it closes and the
 * left one's screen stays mounted, so "the drawer appeared" cannot tell a
 * header REVEAL from a named open. The counters are that distinction, and these
 * tests pin each way they move:
 *
 * - a header press bumps its own counter and picks its screen;
 * - a named open writes the tab through the store and picks the screen the
 *   PLACEMENT resolves, not the panel's slot;
 * - a named open of the RIGHT drawer clears its counter, so a fresh drawer opens
 *   on the stored tab instead of reading as a reveal;
 * - an `editor`-slot takeover resolves to no drawer and changes nothing.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import {
  useMobileDrawerReveals,
  type MobileDrawerReveals,
  type MobileScreen,
} from '@/client/components/mobile/mobile-drawer-reveals';
import { requestOpenPanel } from '@/shared/lib/workspace/panel-open';
import {
  getSessionValue,
  resetSessionStateStore,
} from '@/shared/lib/workspace/session-state/store';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';
import { silenceRealtime, restoreRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const realFetch = globalThis.fetch;

const SESSION = 'session-drawer-reveals';
let win: Window;
let container: HTMLElement;
let drawers: MobileDrawerReveals;

/** The hook needs a real screen state: it must re-render when the drawer moves. */
function Probe({ dock }: { dock: LeftDockHandle }) {
  const [screen, setScreen] = useState<MobileScreen>('main');
  drawers = useMobileDrawerReveals({
    dock,
    sessionId: SESSION,
    currentScreen: screen,
    setCurrentScreen: setScreen,
  });
  return h('p', null, screen);
}

function dockWith(panels: string[], enabled = false): LeftDockHandle {
  return {
    enabled,
    panels,
    setEnabled: () => {},
    setSide: () => {},
    setOrder: () => {},
    widthOf: () => 280,
    commitWidth: () => {},
  };
}

beforeAll(() => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ state: {} }), { status: 200 })) as unknown as typeof fetch;
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  globalThis.fetch = realFetch;
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    const value = nativeGlobals[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
});

beforeEach(() => {
  silenceRealtime();
  resetSessionStateStore();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(() => {
    render(null, container);
  });
  container.remove();
  restoreRealtime();
});

async function mount(dock: LeftDockHandle) {
  await act(async () => {
    render(h(Probe, { dock }), container);
  });
}

describe('header presses are reveals', () => {
  test('the sessions control bumps only the left counter', async () => {
    await mount(dockWith([]));
    expect(drawers.left).toBe(0);
    expect(drawers.right).toBe(0);

    await act(async () => drawers.openSessionDrawer());

    expect(drawers.left).toBe(1);
    expect(drawers.right).toBe(0);
    expect(container.textContent).toBe('session');
  });

  test('the right-panel control bumps the right counter and opens its screen', async () => {
    await mount(dockWith([]));

    await act(async () => drawers.openRightDrawer());

    expect(drawers.right).toBe(1);
    expect(drawers.left).toBe(0);
    expect(container.textContent).toBe('right');
    // A header press does not name a view: it must NOT write a stored tab.
    expect(getSessionValue(SESSION, 'layout.mobileRightPanel')).toBeUndefined();
  });
});

describe('a named open is not a reveal', () => {
  test('a right-placed panel opens the right screen on its stored tab', async () => {
    await mount(dockWith([]));

    await act(async () => drawers.openNamedPanel('files'));

    expect(container.textContent).toBe('right');
    expect(getSessionValue(SESSION, 'layout.mobileRightPanel')).toBe('files');
  });

  test('it clears the right counter so the fresh drawer is not a reveal', async () => {
    await mount(dockWith([]));
    await act(async () => drawers.openRightDrawer());
    expect(drawers.right).toBe(1);

    await act(async () => drawers.openNamedPanel('files'));

    expect(drawers.right).toBe(0);
    expect(container.textContent).toBe('right');
  });

  test('a left-placed panel opens the session screen and leaves the left counter alone', async () => {
    await mount(dockWith(['files'], true));

    await act(async () => drawers.openNamedPanel('files'));

    expect(container.textContent).toBe('session');
    expect(getSessionValue(SESSION, 'layout.mobileLeftPanel')).toBe('files');
    expect(drawers.left).toBe(0);
  });

  test('the window event resolves the same way as the direct call', async () => {
    await mount(dockWith([]));

    await act(async () => requestOpenPanel('files'));

    expect(container.textContent).toBe('right');
    expect(getSessionValue(SESSION, 'layout.mobileRightPanel')).toBe('files');
  });

  test('an editor-slot takeover opens nothing', async () => {
    await mount(dockWith([]));

    await act(async () => drawers.openNamedPanel('plugin:demo:panel'));

    expect(container.textContent).toBe('main');
    expect(drawers.right).toBe(0);
    expect(drawers.left).toBe(0);
    expect(getSessionValue(SESSION, 'layout.mobileRightPanel')).toBeUndefined();
  });
});
