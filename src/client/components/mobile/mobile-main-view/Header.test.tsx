/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone header's session picker is an ANCHORED panel, not a sheet.
 *
 * It used to be pinned to the viewport (`mobileOverlayStyle`), so it opened at
 * the title bar's inset — under the hamburger, not under the title button that
 * was pressed — and the server sheet and the context popover did the same. The
 * reported defect was "menu muncul bukan di bawah tombolnya". The assertion is
 * on the STRUCTURE (a portalled panel placed from the trigger), because a test
 * that only checked the rows would stay green with the sheet restored.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MobileHeader } from '@/client/components/mobile/mobile-main-view/Header';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { silenceRealtime, restoreRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'MouseEvent', 'KeyboardEvent',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;
let container: HTMLElement;

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

beforeEach(async () => {
  silenceRealtime();
  primeKabmoSettings({});
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: 'session-picker',
        children: h(MobileHeader, {
          activeSessionTitle: 'Shell',
          activeSessionId: 'session-picker',
          onOpenSessionSidebar: () => {},
          onOpenRightSidebar: () => {},
          onNewSession: () => {},
          onSelectSession: () => {},
        }) as never,
      }),
      container,
    );
  });
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  primeKabmoSettings({});
  restoreRealtime();
});

const trigger = () => container.querySelector('[data-testid="session-picker"] button') as HTMLButtonElement;
const panel = () => [...document.body.children]
  .map((child) => child.firstElementChild as HTMLElement | null)
  .find((child) => child?.textContent?.includes('Recent Sessions')) ?? null;

describe('phone session picker', () => {
  test('it opens a panel in the document, placed below its trigger', () => {
    expect(panel()).toBeNull();

    act(() => {
      trigger().dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });

    const menu = panel();
    expect(menu).not.toBeNull();
    // Portalled: the header is a `z-20` flex item, so a panel inside it loses to
    // anything at `z-20`+ in the column below.
    expect(container.contains(menu as never)).toBe(false);
    // Placed from the trigger's rectangle by `placeMenu`: the anchor is the zero
    // box happy-dom reports, so the panel sits one GAP below it and one MARGIN
    // inside the left edge — the pre-measure placeholder would be `0px`/hidden.
    expect(menu?.style.top).toBe('4px');
    expect(menu?.style.left).toBe('8px');
    expect(menu?.style.visibility).toBe('');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  test('a click outside closes it', () => {
    act(() => {
      trigger().dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });
    const menu = panel() as HTMLElement;

    act(() => {
      (menu.parentElement as HTMLElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });

    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('phone header visibility menu', () => {
  const header = () => container.querySelector('header') as HTMLElement;
  const menu = () => document.querySelector('[role="menu"][aria-label="Navbar visibility"]') as HTMLElement | null;

  test('a right-click on the header opens the control switch', () => {
    act(() => {
      header().dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }) as unknown as Event);
    });

    const list = menu();
    expect(list).not.toBeNull();
    // The controls this header draws are offered; desktop-only furniture is not.
    expect(list!.textContent).toContain('Right panel');
    expect(list!.textContent).toContain('Reload page');
    expect(list!.textContent).not.toContain('Editor layout');
    expect(list!.textContent).not.toContain('Install app');
    list!.parentElement?.remove();
  });

  test('switching a control off removes it from the row and keeps its row in the menu', () => {
    act(() => {
      header().dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }) as unknown as Event);
    });
    const list = menu() as HTMLElement;
    const row = [...list.querySelectorAll('[role="menuitemcheckbox"]')].find(
      (el) => el.textContent?.includes('Right panel'),
    ) as HTMLButtonElement;
    expect(row).toBeDefined();

    act(() => {
      row.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });

    expect(container.querySelector('button[aria-label="Open Right Panel"]')).toBeNull();
    // The row stays, unchecked: the menu is the only way back.
    expect(row.getAttribute('aria-checked')).toBe('false');
    list.parentElement?.remove();
  });
});
