/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar title bar's collapse control.
 *
 * It used to live in the toolbar's action row, where it competed for width
 * with the actions on the session LIST and could be pushed into the `⋯`
 * overflow menu at a narrow sidebar. A control that governs the PANEL belongs
 * in the title bar — which is exactly where the phone's header puts its own
 * close button — and there it is visible at every width. These cases pin that
 * placement and that it stays reachable when the sidebar is at its minimum.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionSidebarHeader } from '@/client/components/layout/session-sidebar/Header';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount(onCollapse?: () => void) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionSidebarHeader, { onCollapse }), container);
  });
  return container;
}

function collapseButton(el: HTMLElement) {
  return Array.from(el.querySelectorAll('button'))
    .find((b) => /^Collapse Sidebar/.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement | undefined;
}

describe('sidebar title bar', () => {
  test('carries the collapse control beside the wordmark', async () => {
    const el = await mount(() => {});
    const button = collapseButton(el);
    expect(button).toBeDefined();
    // The chord rides in the accessible name, so the shortcut is discoverable
    // (⌘B on macOS, Ctrl+B elsewhere — the keymap decides, not this file).
    expect(button?.getAttribute('aria-label')).toMatch(/[⌘+]\s*B|B$/);
    expect(el.textContent).toContain('Kabmo');
  });

  test('the collapse control runs its handler', async () => {
    let collapsed = 0;
    const el = await mount(() => { collapsed += 1; });
    await act(async () => { collapseButton(el)?.click(); });
    expect(collapsed).toBe(1);
  });

  test('a header with nothing to collapse draws no button', async () => {
    const el = await mount(undefined);
    expect(collapseButton(el)).toBeUndefined();
  });
});
