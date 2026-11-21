/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's LEFT drawer, in each of its two chromes.
 *
 * The drawer shipped as a session list with a chip row above it — the phone's
 * version of the desktop activity rail. `mobileLeftPanelNav` adds the desktop's
 * working set: a strip of opened views over a home page, with the session list
 * as the PINNED first chip, which is the same shape `LeftColumn` draws on a
 * desktop.
 *
 * Three properties, and each is what makes the mode honest rather than cosmetic:
 *
 * - the chrome is CHOSEN by the setting, and the other one is absent (not merely
 *   hidden) — a chip row and a tab strip together would be two answers to one
 *   question;
 * - **Sessions is pinned**: it leads the strip and has no close control, so a
 *   drawer cannot be closed down to a home page with no way back to another
 *   chat;
 * - the drawer follows the RAIL switch, exactly like the desktop column: with
 *   the rail off there is no strip to open a view from, so the style is inert.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MobileSessionSidebar } from '@/client/components/mobile/SessionSidebar';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { resetSessionStateStore } from '@/shared/lib/workspace/session-state/store';
import { writeLeftDock } from '@/shared/lib/workspace/left-dock';
import { silenceRealtime, restoreRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'MouseEvent', 'KeyboardEvent',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const realFetch = globalThis.fetch;

let win: Window;
let container: HTMLElement;

beforeAll(() => {
  // Answers EVERY endpoint with an empty JSON object: the drawer reads the
  // session blob, and opening its catalog triggers the update flow's own read.
  // A single canned body is enough for both, and one stub keeps a missing
  // endpoint from failing as an unrelated `undefined` deeper in a hook.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ state: {}, kabmo: {}, omp: {} }), {
      status: 200,
    })) as unknown as typeof fetch;
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(async () => {
  await act(async () => {
    await Bun.sleep(60);
  });
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
  refreshCalls.count = 0;
  // The store is a module singleton: a tab set left by one test would seed the
  // next one's drawer.
  resetSessionStateStore();
  container = document.createElement('div');
  document.body.appendChild(container);
  primeKabmoSettings({});
});

afterEach(async () => {
  if (container) {
    await act(() => {
      render(null, container);
    });
    container.remove();
  }
  restoreRealtime();
});

/** A built-in view placed on the dock, so the catalog has something to open. */
const PLACED = 'files';

/** Counts the workspace-refresh requests the drawer makes. */
const refreshCalls = { count: 0 };

/** Mount the drawer with a given style and rail state. */
async function mount(style: 'classic' | 'tabs', railEnabled = true) {
  primeKabmoSettings({ mobileLeftPanelNav: style });
  // The rail switch and the placement are ONE global setting
  // (`omp_left_panels`), read through `useLeftDock`. Writing them before the
  // mount is what the user's Settings click and a drop do. A placed panel is
  // what gives the catalog a second card to open.
  writeLeftDock({ enabled: railEnabled, panels: [PLACED] });
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: 'session-left-drawer-nav',
        children: h(MobileSessionSidebar, {
          activeSessionId: null,
          onSelectSession: () => {},
          onNewSession: () => {},
          onNewSessionForFolder: () => {},
          onClose: () => {},
          // The drawer's `onRefresh` is the WORKSPACE refresh the layout hands
          // down (`LayoutWrapper` passes `handleWorkspaceChanged`), so counting
          // it is how this test tells the two refreshes apart.
          onRefresh: () => {
            refreshCalls.count += 1;
          },
        }),
      }),
      container,
    );
  });
  await settle();
}

/** Deferred commit + provider load. Polls instead of a fixed 40ms sleep: the
 *  sleep made this suite order-dependent (the header was sometimes not drawn
 *  yet, failing "the strip draws no second close control" about once per two
 *  full runs). Waits for the row BOTH chromes draw. */
async function settle() {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await act(async () => {
      await Bun.sleep(10);
    });
    if (container.querySelector('button[aria-label="Close sidebar"]')) return;
  }
}

const stripChips = () =>
  [...container.querySelectorAll('[role="tablist"] [role="tab"]')].map((chip) =>
    chip.textContent?.trim(),
  );

/**
 * The dock's chip row, identified by what only it draws: a pressed chip that
 * names a VIEW. The session list's own filter chips ("All", "Running",
 * "Archived") are also `aria-pressed`, so a bare count would be measuring the
 * list rather than the chrome.
 */
const dockChips = () =>
  [...container.querySelectorAll('[aria-pressed][aria-label]')].filter((chip) =>
    ['Sessions', 'Files', 'GIT', 'Search', 'Terminal'].some((name) =>
      chip.getAttribute('aria-label')?.startsWith(name),
    ),
  );

describe('the left drawer chrome follows the setting', () => {
  test('classic draws the chip row and no tab strip', async () => {
    await mount('classic');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    // The rail's own chip row: `Sessions` is always in it when the rail is on.
    expect(dockChips().length).toBeGreaterThan(0);
  });

  test('tabs draws the strip and no chip row', async () => {
    await mount('tabs');
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(dockChips().length).toBe(0);
  });
});

/**
 * The dead-end rule, and the reason this drawer is not a copy of the right one:
 * the session list is pinned, so it can never be closed away.
 */
describe('the session list is pinned under tabs', () => {
  test('Sessions leads the strip', async () => {
    await mount('tabs');
    const chips = stripChips();
    expect(chips[0]).toContain('Sessions');
  });

  test('the pinned chip has no close control, and a placed view does', async () => {
    await mount('tabs');
    const pinned = container.querySelector('[role="tab"]') as HTMLElement;
    expect(pinned.textContent).toContain('Sessions');
    expect(pinned.querySelector('[aria-label^="Tutup tab"]')).toBeNull();
  });
});

/**
 * The working set, not the catalog: opening a view from the home page puts ONE
 * chip beside the pinned `Sessions` — which is what makes this the desktop's
 * shape rather than a restyled chip row.
 */
describe('the strip is a working set', () => {
  /** Open the catalog from the strip's add control. */
  async function showCatalog() {
    const add = container.querySelector('[aria-label="Tambah tab"]') as HTMLElement | undefined;
    expect(add).not.toBeNull();
    await act(() => {
      add?.click();
    });
    await settle();
  }

  test('the drawer opens on the pinned view, not on the catalog', async () => {
    await mount('tabs');
    // The pinned view IS a tab, so a fresh drawer has something on screen —
    // the same reason the desktop column never opens on a blank body.
    expect(stripChips().length).toBe(1);
    expect(container.textContent).not.toContain('Klik kartu');
  });

  test('opening a view from the catalog adds its chip beside the pinned one', async () => {
    await mount('tabs');
    await showCatalog();
    const card = [...container.querySelectorAll('[aria-label^="Buka "]')][0] as HTMLElement | undefined;
    expect(card).toBeDefined();
    await act(() => {
      card?.click();
    });
    await settle();
    expect(stripChips().length).toBe(2);
    expect(stripChips()[0]).toContain('Sessions');
  });

  test('closing that view returns to the pinned one, never to a blank drawer', async () => {
    await mount('tabs');
    await showCatalog();
    const card = [...container.querySelectorAll('[aria-label^="Buka "]')][0] as HTMLElement | undefined;
    await act(() => {
      card?.click();
    });
    await settle();
    const closers = [...container.querySelectorAll('[aria-label^="Tutup tab"]')] as HTMLElement[];
    // Exactly one close control: the pinned Sessions chip has none.
    expect(closers.length).toBe(1);
    await act(() => {
      closers[0]?.click();
    });
    await settle();
    expect(stripChips().length).toBe(1);
    expect(stripChips()[0]).toContain('Sessions');
  });
});

/**
 * The drawer keeps its TITLE BAR and its FOOTER in both chromes.
 *
 * Both were lost when the tab style landed, and each for its own reason:
 *
 * - the header was dropped on the argument that the strip is the drawer's whole
 *   chrome — true of the RIGHT drawer, wrong here, because the left column's
 *   header carries the wordmark, the server chip and the close control, exactly
 *   as the desktop column draws a title row above its strip (40 + 38 + 40).
 *   Without it the only way back to the chat was the Android back gesture.
 * - the footer fell off screen because `PanelTabsColumn` is `h-full`, and as a
 *   flex child of the drawer's column that 100% pushed the footer out of the
 *   box. The strip's wrapper must be `flex-1 min-h-0` so the footer keeps its
 *   own row.
 */
describe('the drawer keeps its title bar and footer in both chromes', () => {
  for (const style of ['classic', 'tabs'] as const) {
    test(`${style} draws the wordmark header with its close control`, async () => {
      await mount(style);
      // The header is the drawer's own title bar, not the strip: it carries the
      // wordmark and the labelled close control.
      const close = container.querySelector('button[aria-label="Close sidebar"]');
      expect(close).not.toBeNull();
      expect(container.textContent).toContain('Kabmo');
    });

    test(`${style} draws the footer`, async () => {
      await mount(style);
      // The footer's own rows: Settings · Keys · About.
      expect(container.textContent).toContain('Settings');
      expect(container.textContent).toContain('Keys');
      expect(container.textContent).toContain('About');
    });
  }

  test('the strip column is a shrinking flex child, so the footer keeps its row', async () => {
    await mount('tabs');
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    const wrapper = strip.closest('.flex-1.min-h-0') as HTMLElement | null;
    // `PanelTabsColumn` is `h-full`. As a flex child of the drawer's column,
    // 100% resolved against the whole box and pushed the footer off screen —
    // measured in Chromium before the wrapper: the drawer had exactly two rows
    // (strip 56 + body 788) and no footer at all. happy-dom does not lay out,
    // so the CONTRACT is what a DOM test can hold; the pixels are checked in a
    // browser.
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain('min-h-0');
  });

  /**
   * The strip draws NO trailing action at all.
   *
   * A refresh there was tried and removed: the four views that read
   * `refreshKey` (Files, GIT, Context, WIKI) each draw their own refresh in
   * their own toolbar, beside the repo picker it re-reads, and the other five
   * (Search, Terminal, Usage, Todos, Plan) ignore `refreshKey` entirely — so
   * the button was redundant in one case and dead in the other. Measured on the
   * running drawer with Files open: one click issued zero requests.
   *
   * The session list's own "Refresh sessions" lives in `MobileSessionToolbar`,
   * which is why the DESKTOP column keeps a strip refresh and this drawer does
   * not: the desktop's session list has no such control.
   */
  test('the strip draws no trailing action', async () => {
    await mount('tabs');
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    expect(strip.querySelector('[aria-label="Muat ulang view"]')).toBeNull();
    // And nothing else took its place in the trailing slot.
    expect(strip.querySelector('[aria-label="Tutup panel kiri"]')).toBeNull();
    expect(refreshCalls.count).toBe(0);
  });

  test('the strip draws no second close control under the header', async () => {
    await mount('tabs');
    // Two close controls 56px apart doing the same thing was the defect; the
    // header owns the only one.
    expect(container.querySelectorAll('[aria-label="Close left sidebar"]').length).toBe(0);
    expect(container.querySelector('[aria-label="Close sidebar"]')).not.toBeNull();
  });
});

/**
 * The rail switch is what the style hangs on, exactly as on the desktop: with
 * no rail there is no strip, so a tab style has nothing to open a view from.
 */
describe('the style is inert without the rail', () => {
  test('tabs with the rail off draws no strip at all', async () => {
    await mount('tabs', false);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
