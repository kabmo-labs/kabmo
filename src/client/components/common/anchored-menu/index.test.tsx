/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The portalled menu panel.
 *
 * The regression this pins is the reported one: a `z-50` panel rendered INSIDE
 * its trigger's subtree is still confined to that ancestor's stacking context,
 * so a `sticky z-10` workspace header covered its own `⋯` menu with the NEXT
 * header's surface, and a `z-50` panel inside the navbar's `z-20` header lost to
 * anything at `z-20`+ in the chat column. The fix is structural — the panel is a
 * child of `document.body` — so the test asserts the STRUCTURE, because a test
 * that only asserted the menu's rows would stay green with the bug restored.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { AnchoredMenu } from '@/client/components/common/anchored-menu';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;
let host: HTMLElement;
let closed: number;

const ANCHOR = { top: 100, right: 300, bottom: 122, left: 278 };

function mount(anchor = ANCHOR) {
  closed = 0;
  win.document.body.innerHTML = '';
  host = win.document.createElement('div') as unknown as HTMLElement;
  // The host stands in for the sidebar's `sticky z-10` header: it is a stacking
  // context, so a panel rendered inside it can never paint over a sibling.
  host.style.position = 'relative';
  host.style.zIndex = '10';
  win.document.body.appendChild(host as never);
  act(() => {
    render(
      h(AnchoredMenu, {
        anchor,
        ariaLabel: 'Options for kabmo',
        className: 'w-44 rounded-md bg-paper',
        onClose: () => {
          closed += 1;
        },
        children: h('button', { type: 'button' }, 'Pin Workspace'),
      }),
      host as never,
    );
  });
}

/** The panel is labelled, not roled: see `AnchoredMenuProps.role`. */
const panel = () => win.document.querySelector('[aria-label="Options for kabmo"]') as HTMLElement | null;

beforeEach(() => {
  win = new Window({ url: 'http://127.0.0.1:3001/' });
  installDomGlobals(win);
});

afterEach(() => {
  if (host) act(() => render(null, host as never));
  restoreDomGlobals();
});

describe('AnchoredMenu', () => {
  test('the panel is a child of the document, never of its stacking ancestor', () => {
    mount();
    const menu = panel();
    expect(menu).not.toBeNull();
    // The bug, stated as an assertion: inside `host` it would be clipped by the
    // NEXT sticky header and by the sidebar's own scroller.
    expect(host.contains(menu as never)).toBe(false);
    expect(win.document.body.contains(menu as never)).toBe(true);
  });

  test('it is placed from the anchor, right edges aligned', () => {
    mount();
    const menu = panel();
    // The panel is `fixed` by class (happy-dom computes no layout, so the box is
    // 0×0 and the arithmetic is covered by `menu-anchor.test.ts`); what this
    // asserts is that the placement is applied HERE rather than by the caller's
    // CSS, which is what lets it escape the ancestor's clipping.
    expect(menu?.className).toContain('fixed');
    expect(menu?.style.top).toBe('126px');
    expect(menu?.style.left).toBe('300px');
    expect(menu?.style.maxHeight).not.toBe('');
    // Not the pre-measure placeholder, which is hidden until the layout effect
    // has run.
    expect(menu?.style.visibility).toBe('');
  });

  test('Escape closes it', () => {
    mount();
    act(() => {
      win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(1);
  });

  test('a click on the backdrop closes it, a click on a row does not', () => {
    mount();
    const menu = panel() as HTMLElement;
    const row = menu.querySelector('button') as HTMLButtonElement;

    act(() => {
      row.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });
    expect(closed).toBe(0);

    act(() => {
      (menu.parentElement as HTMLElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });
    expect(closed).toBe(1);
  });

  test('without an anchor it renders nothing', () => {
    closed = 0;
    win.document.body.innerHTML = '';
    const bare = win.document.createElement('div');
    win.document.body.appendChild(bare as never);
    act(() => {
      render(
        h(AnchoredMenu, {
          anchor: null,
          ariaLabel: 'closed',
          className: 'w-44',
          onClose: () => {
            closed += 1;
          },
          children: null,
        }),
        bare as never,
      );
    });
    expect(panel()).toBeNull();
  });
});
