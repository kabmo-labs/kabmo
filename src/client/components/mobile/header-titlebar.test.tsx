/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's headers are title bars, and they say so.
 *
 * A desktop shell window may be narrower than `App`'s 768px layout breakpoint —
 * macOS, Windows and Linux all allow a 720px window — so a narrowed shell
 * window renders the PHONE layout, and whichever header is on screen becomes
 * the window's top strip. Three things follow, and all three were missing:
 *
 * 1. **`data-drag-region`.** macOS and Linux decide a drag from that attribute,
 *    so a header without it is a strip the window cannot be moved by. The main
 *    screen had none, and the right drawer had none at all.
 * 2. **The shell's own left inset.** `titlebarPaddingLeft` reads
 *    `env(titlebar-area-x)`, which a native WKWebView never defines, so the
 *    76px macOS reserves for its traffic lights has to come from
 *    `titlebarInsetLeft` — without it the hamburger and the wordmark sat under
 *    the buttons.
 * 3. **`titlebar-no-drag` on the controls.** `app-region` INHERITS, so marking
 *    a header as a drag region turns every control in it into a drag handle on
 *    Windows unless the control says otherwise — and a drag handle swallows its
 *    own click.
 *
 * Asserted on the RENDERED markup, because a header's class list and attributes
 * are what the shells read; a source-level check would pass on a component that
 * rendered something else.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MobileHeader } from '@/client/components/mobile/mobile-main-view/Header';
import { MobileSessionHeader } from '@/client/components/mobile/mobile-session-sidebar/Header';
import { MobileRightSidebar } from '@/client/components/mobile/RightSidebar';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { CONTROL_ROW_HEIGHT, CONTROL_ROW_INSET } from '@/client/lib/ui/control-plate';
import { silenceRealtime, restoreRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'MouseEvent', 'KeyboardEvent',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/**
 * The session-state read, answered instead of attempted.
 *
 * The provider reads `/api/sessions/<id>/state` on mount, and this window's
 * relative URL is invalid outside a page, so the read REJECTS. The rejection's
 * continuation then lands after the case ended and re-renders the provider,
 * which diffs away the header it had already dropped — and the header's menus
 * clean up by touching `document`, which `afterAll` has removed by then. The
 * subject here is the headers' markup, never the store, so the read answers an
 * empty blob and nothing is left in flight.
 */
const realFetch = globalThis.fetch;

let win: Window;
let container: HTMLElement;

/** The shell's globals, which the DOM's `window` type does not declare. */
type Shell = {
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  __kabmoDesktop?: Record<string, unknown>;
};

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
  // Flush anything still queued (a provider's continuation, a deferred commit)
  // while `document` is installed. Preact schedules its effect/commit work
  // through `requestAnimationFrame` with a 35 ms `setTimeout` fallback, and
  // `requestAnimationFrame` is absent in this suite, so the fallback is what
  // runs — a zero-delay drain misses it, and on Windows the callback then fires
  // after the next file's compilation, i.e. after this `afterAll` removed the
  // globals: `ReferenceError: document is not defined` from `preact.render`'s
  // portal teardown, reported against the file that happens to run next.
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
  // The headers subscribe to the realtime channel on mount; this window's
  // origin answers nothing, and a refused dial fails asynchronously — after
  // this suite has restored the globals, which reports against the NEXT file.
  silenceRealtime();
  // Settings are primed per mount; a suite-level default keeps a style written
  // by one test from deciding the next one's chrome.
  primeKabmoSettings({});
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (container) {
    // Unmount INSIDE `act`, so every cleanup (the menus' keydown listener,
    // above all) has run before the next step. A bare `render(null)` leaves
    // Preact's debounced cleanup queued, and it then runs after `afterAll`
    // restored the globals — measured on Windows as
    // `ReferenceError: document is not defined` in anchored-menu, reported
    // against this file.
    await act(() => {
      render(null, container);
    });
    container.remove();
  }
  restoreRealtime();
  const shell = win as unknown as Shell;
  delete shell.__kabmoDesktop;
  delete shell.__kabmoCall;
});

/** Mount a header as a macOS shell window would see it. */
async function mountAsMacShell(node: () => unknown): Promise<void> {
  const shell = win as unknown as Shell;
  shell.__kabmoCall = async () => null;
  shell.__kabmoDesktop = {
    platform: 'macos', shellVersion: '0.1.0', overlayTitlebar: true, trafficLightInset: '5rem',
  };
  // The headers embed the shared control cluster, which reads the session's
  // state (the editor/panel toggles and the plugin slots) — the real provider is
  // what a shell window mounts them inside.
  await act(async () => {
    render(
      h(SessionStateProvider, { sessionId: 'session-shell-header', children: node() as never }),
      container,
    );
  });
}

describe('phone headers as a shell title bar', () => {
  test('the main header carries the drag region and the shell inset', async () => {
    await mountAsMacShell(() =>
      h(MobileHeader, {
        activeSessionTitle: 'Shell',
        activeSessionId: 'session-shell-header',
        onOpenSessionSidebar: () => {},
        onOpenRightSidebar: () => {},
        onNewSession: () => {},
        onSelectSession: () => {},
      }),
    );
    const header = container.querySelector('header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.hasAttribute('data-drag-region')).toBe(true);
    // `5rem` is what this shell reported; the caller's own 0.75rem would leave
    // the hamburger under the traffic lights.
    expect(header.style.paddingLeft).toContain('5rem');
    // And the controls inside it must not inherit the drag region.
    expect(header.querySelector('.titlebar-no-drag')).toBeTruthy();
  });

  test('the sessions drawer header carries the drag region and the shell inset', async () => {
    await mountAsMacShell(() => h(MobileSessionHeader, { onClose: () => {} }));
    const header = container.firstElementChild as HTMLElement;
    expect(header.hasAttribute('data-drag-region')).toBe(true);
    expect(header.style.paddingLeft).toContain('5rem');
    expect(header.querySelector('.titlebar-no-drag')).toBeTruthy();
  });

  test('the right drawer header is a drag region whose controls are not', async () => {
    // `classic` still has a header — the chip strip lives in it.
    await mountAsMacShell(() =>
      h(MobileRightSidebar, { enabled: false, onClose: () => {} }),
    );
    const drag = container.querySelector('[data-drag-region]') as HTMLElement;
    expect(drag).toBeTruthy();
    expect(drag.style.paddingLeft).toContain('5rem');
    const close = drag.querySelector('button[aria-label="Close right sidebar"]') as HTMLElement;
    expect(close).toBeTruthy();
    // The close button is a control in a drag region: without this it is a
    // drag handle on Windows and its click never fires.
    expect(close.className).toContain('titlebar-no-drag');
  });

  /**
   * Under `tabs` there is no header: the strip above the body is the whole
   * chrome, exactly as on the desktop. It inherits the window contract the
   * header used to carry, and the close control moves into its trailing
   * actions — so a narrowed shell window still has a handle AND a way out.
   */
  test('under tabs the strip is the title bar and owns the close control', async () => {
    primeKabmoSettings({ mobileRightPanelNav: 'tabs' });
    await mountAsMacShell(() =>
      h(MobileRightSidebar, { enabled: false, onClose: () => {} }),
    );
    const drag = container.querySelector('[data-drag-region]') as HTMLElement;
    expect(drag).toBeTruthy();
    expect(drag.getAttribute('role')).toBe('tablist');
    expect(drag.className).toContain('titlebar-drag-region');
    expect(drag.style.paddingLeft).toContain('5rem');
    // No second row: the only horizontal chrome is the strip.
    expect(container.querySelectorAll('header').length).toBe(0);
    // The close control is still here, now in the strip's trailing actions.
    const close = drag.querySelector('button[aria-label="Close right sidebar"]') as HTMLElement;
    expect(close).toBeTruthy();
    expect(close.closest('.titlebar-no-drag')).not.toBeNull();
  });

  test('a right-click on the right drawer header opens the panel switch', async () => {
    await mountAsMacShell(() =>
      h(MobileRightSidebar, { enabled: false, onClose: () => {} }),
    );
    const drag = container.querySelector('[data-drag-region]') as HTMLElement;
    act(() => {
      drag.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }) as unknown as Event);
    });
    const menu = document.querySelector('[role="menu"][aria-label="Panels visibility"]');
    expect(menu).not.toBeNull();
    // The drawer's own catalog: a built-in view is offered, and the session
    // list is not — it is the LEFT drawer's screen, not a panel here.
    expect(menu!.textContent).toContain('Files');
    expect(menu!.textContent).not.toContain('Sessions');
    menu!.parentElement?.remove();
  });

  test('under tabs a right-click on the strip opens the same switch', async () => {
    primeKabmoSettings({ mobileRightPanelNav: 'tabs' });
    await mountAsMacShell(() =>
      h(MobileRightSidebar, { enabled: false, onClose: () => {} }),
    );
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    act(() => {
      strip.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }) as unknown as Event);
    });
    const menu = document.querySelector('[role="menu"][aria-label="Panels visibility"]');
    expect(menu).not.toBeNull();
    menu!.parentElement?.remove();
  });

  /**
   * The strip is the phone's title bar, so it carries the SAFE AREA the way
   * every other phone header does — `height: calc(row + inset)` AND
   * `padding-top: inset`.
   *
   * Both are load-bearing and they are not interchangeable: with only the
   * height, the row grows but its content stays pinned to y=0, so every chip
   * sits under the status bar; with only the padding, `box-sizing: border-box`
   * eats the padding out of the row and the chips are squeezed into a 16px
   * content box. `MobileHeader` and `MobileSessionHeader` state the pair, and
   * this strip is their peer.
   */
  test('the tabs strip reserves the notch as height AND padding, like the other headers', async () => {
    primeKabmoSettings({ mobileRightPanelNav: 'tabs' });
    await mountAsMacShell(() =>
      h(MobileRightSidebar, { enabled: false, onClose: () => {} }),
    );
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    // Asserted against the SHARED constants, not a class spelling: the row
    // height is the phone header's 56px plus the notch, stated once in
    // `control-plate.ts` so this strip cannot drift to a third density.
    expect(strip.className).toContain(CONTROL_ROW_HEIGHT.mobile);
    expect(strip.className).toContain(CONTROL_ROW_INSET.mobile);
    // Both halves of the notch are in that one string: height AND padding.
    expect(CONTROL_ROW_HEIGHT.mobile).toContain('3.5rem');
    expect(CONTROL_ROW_HEIGHT.mobile).toContain('pt-[env(safe-area-inset-top,0px)]');
  });

  /**
   * The close control is the plain panel mark, NOT `PanelRightClose`.
   *
   * That icon draws a chevron inside the panel (`m8 9 3 3-3 3`), which reads as
   * "collapse this column" — a second meaning on a strip whose chips already
   * carry their own `X`. Asserted on the rendered glyph so swapping the import
   * back cannot pass.
   */
  test('the strip close control draws the plain panel icon, with no chevron', async () => {
    primeKabmoSettings({ mobileRightPanelNav: 'tabs' });
    await mountAsMacShell(() =>
      h(MobileRightSidebar, { enabled: false, onClose: () => {} }),
    );
    const close = container.querySelector('button[aria-label="Close right sidebar"]') as HTMLElement;
    expect(close).not.toBeNull();
    const paths = [...close.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
    expect(paths).toContain('M15 3v18');
    expect(paths.some((d) => d.includes('3-3'))).toBe(false);
  });

  /** A browser tab has no shell, so nothing is reserved and nothing is marked. */
  test('a browser marks no drag region and reserves nothing', async () => {
    await act(async () => {
      render(
        h(SessionStateProvider, {
          sessionId: 'session-shell-header',
          children: h(MobileSessionHeader, { onClose: () => {} }),
        }),
        container,
      );
    });
    const header = container.firstElementChild as HTMLElement;
    expect(header.hasAttribute('data-drag-region')).toBe(false);
    expect(header.style.paddingLeft).not.toContain('5rem');
  });
});
