/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
import { silenceRealtime, restoreRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'MouseEvent', 'KeyboardEvent',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;
let container: HTMLElement;

/** The shell's globals, which the DOM's `window` type does not declare. */
type Shell = {
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  __kabmoDesktop?: Record<string, unknown>;
};

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
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
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) {
    render(null, container);
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
