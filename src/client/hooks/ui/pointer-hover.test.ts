/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `usePointerHover` exists because a CSS `:hover` on a hairline handle can stay
 * applied after the pointer has left it. The two directions are pinned here:
 * the element's own enter/leave drive the state, and a document `pointermove`
 * outside the element's box clears a state a missed leave left behind.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Window } from 'happy-dom';

import { usePointerHover } from '@/client/hooks/ui/pointer-hover';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let win: Window;

beforeEach(() => {
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

function mountHandle(): { handle: HTMLElement; hovered: () => boolean } {
  const state = { hovered: false };
  const handle = document.createElement('div');
  handle.getBoundingClientRect = () =>
    ({ left: 100, right: 103, top: 0, bottom: 100, width: 3, height: 100, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
  function Handle() {
    const ref = { current: handle };
    state.hovered = usePointerHover(ref);
    return h('div', { 'data-testid': 'handle' });
  }
  document.body.appendChild(handle);
  act(() => render(h(Handle, {}), handle));
  return { handle, hovered: () => state.hovered };
}

function fire(target: EventTarget, type: string, init?: { clientX?: number; clientY?: number }): void {
  const view = win as unknown as { MouseEvent: new (t: string, i?: unknown) => globalThis.Event };
  const event = new view.MouseEvent(type, { bubbles: true, ...init });
  act(() => { target.dispatchEvent(event); });
}

describe('usePointerHover', () => {
  test('enter lights the handle and leave clears it', () => {
    const { handle, hovered } = mountHandle();
    expect(hovered()).toBe(false);

    fire(handle, 'pointerenter');
    expect(hovered()).toBe(true);

    fire(handle, 'pointerleave');
    expect(hovered()).toBe(false);
  });

  test('a document move outside the box clears a missed leave', () => {
    const { handle, hovered } = mountHandle();
    fire(handle, 'pointerenter');
    expect(hovered()).toBe(true);

    fire(document, 'pointermove', { clientX: 500, clientY: 50 });
    expect(hovered()).toBe(false);
  });

  test('a document move inside the box keeps the state', () => {
    const { handle, hovered } = mountHandle();
    fire(handle, 'pointerenter');

    fire(document, 'pointermove', { clientX: 101, clientY: 50 });
    expect(hovered()).toBe(true);
  });

  test('a document move inside the box lights a handle whose enter was missed', () => {
    const { hovered } = mountHandle();
    expect(hovered()).toBe(false);

    fire(document, 'pointermove', { clientX: 101, clientY: 50 });
    expect(hovered()).toBe(true);
  });
});
