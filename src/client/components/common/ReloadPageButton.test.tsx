/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The reload control both layouts draw.
 *
 * The load-bearing property is the accessible name: the phone's header and the
 * desktop navbar must expose the same control, or a spec (and a screen reader)
 * that addresses "Reload page" finds it on one layout and not the other. The
 * click itself is pinned too — a button that renders the right label and does
 * nothing is exactly what a markup assertion cannot see.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { ReloadPageButton } from '@/client/components/common/ReloadPageButton';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;
let container: HTMLElement;
let reloads = 0;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  // happy-dom's location.reload would navigate; the assertion is that it ran.
  win.location.reload = () => {
    reloads += 1;
  };
});

afterEach(() => {
  if (container) render(null, container);
  reloads = 0;
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

describe('ReloadPageButton', () => {
  test('is addressable by the same name on every layout', () => {
    const el = mount(h(ReloadPageButton, { className: 'p-1.5' }));
    const button = el.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Reload page');
    expect(button?.getAttribute('title')).toBe('Reload page');
  });

  test('clicking it reloads the page', () => {
    const el = mount(h(ReloadPageButton, { className: 'p-1.5' }));
    const button = el.querySelector('button');
    act(() => {
      button?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(reloads).toBe(1);
  });

  test('sizes its icon per surface while keeping the caller class', () => {
    const el = mount(h(ReloadPageButton, { size: 18, className: 'w-8 h-8' }));
    const button = el.querySelector('button');
    expect(button?.getAttribute('class')).toBe('w-8 h-8');
    const svg = button?.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('18');
  });
});
