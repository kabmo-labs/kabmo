/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's right drawer, in each of its two chromes.
 *
 * The drawer used to show EVERY view as a chip, so it opened on eleven chips the
 * user had to read through. `mobileRightPanelNav` adds the desktop's working set
 * to the phone: the strip holds only what was opened, a home page lists the
 * rest, and the drawer reopens where the user left it. `classic` stays the
 * default so an upgrade rearranges nothing.
 *
 * Three properties, and each is what makes the mode honest rather than cosmetic:
 *
 * - the chrome is CHOSEN by the setting, and the other one is absent (not merely
 *   hidden) — two strips would be two answers to one question;
 * - the home page appears when nothing is open and disappearing once a card is
 *   picked, so a suggestion is not left over the body forever;
 * - closing the last tab returns to the home page instead of a blank drawer.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MobileRightSidebar } from '@/client/components/mobile/RightSidebar';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { resetSessionStateStore } from '@/shared/lib/workspace/session-state/store';
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
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ state: {} }), { status: 200 })) as unknown as typeof fetch;
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
  // The store is a module singleton: a close left behind by one test would
  // otherwise seed the next one's drawer.
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

async function mount(style: 'classic' | 'tabs') {
  primeKabmoSettings({ mobileRightPanelNav: style });
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: 'session-drawer-nav',
        children: h(MobileRightSidebar, {
          enabled: false,
          onClose: () => {},
        }),
      }),
      container,
    );
  });
  // The provider loads its blob and settles its first commit after mount, and
  // the strip renders from the hook's first post-load value: without a drain the
  // assertions read the pre-ready tree.
  await settle();
}

/** Let Preact's deferred commit and the provider's load continuation run. */
async function settle() {
  await act(async () => {
    await Bun.sleep(40);
  });
}

const stripChips = () =>
  [...container.querySelectorAll('[role="tablist"] [role="tab"]')].map((chip) =>
    chip.textContent?.trim(),
  );

describe('the drawer chrome follows the setting', () => {
  test('classic lists views as chips in the header', async () => {
    await mount('classic');
    // `PanelChips` marks its buttons pressed; the tab strip uses roles.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelectorAll('[aria-pressed]').length).toBeGreaterThan(1);
  });

  test('tabs draws the strip and NO full chip list', async () => {
    await mount('tabs');
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    // The header's own chips are gone: the strip is the only list of views.
    expect(container.textContent).not.toContain('Sessions');
  });
});

describe('the home page is the empty state', () => {
  test('nothing open shows the catalog, not a blank body', async () => {
    await mount('tabs');
    expect(container.textContent).toContain('Klik kartu');
  });

  test('the home page is gone once a view is open', async () => {
    await mount('tabs');
    const card = [...container.querySelectorAll('[aria-pressed]')].find((element) =>
      element.getAttribute('aria-label')?.startsWith('Buka '),
    ) as HTMLElement | undefined;
    expect(card).toBeDefined();
    await act(() => {
      card?.click();
    });
    await settle();
    expect(container.textContent).not.toContain('Klik kartu');
    expect(stripChips().length).toBe(1);
  });

  test('closing the last tab returns to the catalog', async () => {
    await mount('tabs');
    const card = [...container.querySelectorAll('[aria-pressed]')].find((element) =>
      element.getAttribute('aria-label')?.startsWith('Buka '),
    ) as HTMLElement | undefined;
    await act(() => {
      card?.click();
    });
    await settle();
    const close = container.querySelector('[aria-label^="Tutup tab"]') as HTMLElement;
    expect(close).not.toBeNull();
    await act(() => {
      close.click();
    });
    await settle();
    expect(stripChips().length).toBe(0);
    expect(container.textContent).toContain('Klik kartu');
  });

  test('classic has no home page at all', async () => {
    await mount('classic');
    expect(container.textContent).not.toContain('Klik kartu');
  });
});

/**
 * A tab the user closed must stay closed, and the next open must not bring it
 * back.
 *
 * `layout.mobileRightPanel` is TWO things at once: the mirror of the strip's
 * selection, and the slot an outside caller writes to ask for a view. Closing a
 * tab writes the neighbour into it, but the mirror (`activeTab`) is one render
 * behind — so the seed effect read the just-closed id as a request and reopened
 * it. That is the reported pair of symptoms: the active tab would not close, and
 * opening a new panel brought the previous one back with it.
 *
 * Both cases are here, and each fails without the drawer marking its own
 * gestures (`ownGesture`).
 */
describe('closing a tab', () => {
  /** Click a home-page card by its view title. */
  async function openCard(title: string) {
    const card = [...container.querySelectorAll('[aria-label^="Buka "]')].find(
      (element) => element.getAttribute('aria-label') === `Buka ${title}`,
    ) as HTMLElement | undefined;
    expect(card).toBeDefined();
    await act(() => {
      card?.click();
    });
    await settle();
  }

  /** Re-open the catalog from the strip's add control. */
  async function showCatalog() {
    const add = container.querySelector('[aria-label="Tambah tab"]') as HTMLElement | undefined;
    expect(add).not.toBeNull();
    await act(() => {
      add?.click();
    });
    await settle();
  }

  /** Two tabs open, the second one on screen. */
  async function openTwoTabs() {
    await mount('tabs');
    await openCard('Files');
    await showCatalog();
    await openCard('Source Control');
    expect(stripChips().length).toBe(2);
  }

  test('closing the ACTIVE tab removes it', async () => {
    await openTwoTabs();
    // The chip states the view's LABEL, and the close control is named after it.
    const active = stripChips()[1] ?? '';
    const close = container.querySelector(`[aria-label="Tutup tab ${active}"]`) as
      | HTMLElement
      | null;
    expect(close).not.toBeNull();
    await act(() => {
      close?.click();
    });
    await settle();
    expect(stripChips()).toEqual(['Files']);
  });

  test('a closed tab does not reopen when the next one is opened', async () => {
    await openTwoTabs();
    const active = stripChips()[1] ?? '';
    const close = container.querySelector(`[aria-label="Tutup tab ${active}"]`) as
      | HTMLElement
      | null;
    await act(() => {
      close?.click();
    });
    await settle();

    // The report's second half: opening another view must not resurrect it.
    await showCatalog();
    await openCard('Search');
    expect(stripChips()).toEqual(['Files', 'Search']);
  });
});
