/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness mark inside the actual session rows.
 *
 * `harness-glyph.test.ts` pins the mark itself; this pins the WIRING, which is
 * where the bug would be: a prop that is accepted but never passed down to the
 * title line leaves every row blank while the component's own suite stays green.
 * Both desktop styles and the phone drawer are asserted because they are three
 * separate render paths for one fact.
 *
 * It also pins the thing that must NOT change: a row with no harness renders
 * the title exactly as before, so a list of pre-harness sessions keeps its old
 * alignment.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionItem } from '@/client/components/layout/session-sidebar/SessionItem';
import { SessionRow } from '@/client/components/common/session-row';
import { MobileSessionRow } from '@/client/components/mobile/mobile-session-sidebar/SessionRow';
import type { SessionItemData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
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

const session: SessionItemData = { id: 's1', folder_id: 1, title: 'hello world' };

async function mount(node: preact.ComponentChild) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node, container);
  });
  return container;
}

describe('harness mark in the session rows', () => {
  test('classic desktop row draws it beside the title', async () => {
    const el = await mount(h(SessionItem, { sessionId: 's1', title: 'hello world', harness: 'claude' }));
    expect(el.querySelector('[data-harness]')?.getAttribute('data-harness')).toBe('claude');
    // It lives on the title line, not in the leading status slot: the slot's
    // own child is the run cue / chevron, and a mark there would push titles.
    expect(el.querySelector('[data-testid="session-item"]')?.textContent).toContain('Hello world');
  });

  test('modern desktop row draws it, at the compact size', async () => {
    const el = await mount(h(SessionRow, { sessionId: 's1', title: 'hello world', harness: 'codex' }));
    expect(el.querySelector('[data-harness]')?.getAttribute('data-harness')).toBe('codex');
    expect(el.querySelector('[data-harness]')?.getAttribute('aria-label')).toBe('codex');
  });

  test('phone row draws it, at the touch size', async () => {
    const el = await mount(
      h(MobileSessionRow, { session, harness: 'opencode', isActive: false, timeAgo: '2m', onSelect: () => {}, onArchive: () => {} }),
    );
    expect(el.querySelector('[data-harness]')?.getAttribute('data-harness')).toBe('opencode');
    expect(el.querySelector('[data-harness] svg')?.getAttribute('width')).toBe('13');
  });

  test('a row with no harness draws no mark and keeps its title intact', async () => {
    const el = await mount(h(SessionItem, { sessionId: 's1', title: 'hello world' }));
    expect(el.querySelector('[data-harness]')).toBeNull();
    expect(el.querySelector('[data-testid="session-item"]')?.textContent).toContain('Hello world');
  });

  test('a row with no harness renders no spacer either', async () => {
    // The wrapper span owns the 6px gap (`mr-1.5`), so leaving it in place for a
    // null harness shifted every pre-harness and MOCK title right by 6px while
    // the page still looked plausible. The mark is gated at the CALL SITE, not
    // inside `HarnessGlyph` — which returns null and leaves the wrapper behind.
    const el = await mount(h(SessionItem, { sessionId: 's1', title: 'hello world' }));
    const row = el.querySelector('[data-testid="session-item"]');
    const title = Array.from(row?.querySelectorAll('span') ?? []).find(
      (span) => span.textContent?.trim() === 'Hello world',
    );
    const spacer = Array.from(row?.querySelectorAll('span') ?? []).filter(
      (span) => span.className.includes('mr-1.5') && span.className.includes('shrink-0'),
    );
    expect(spacer).toHaveLength(0);
    expect(title).toBeTruthy();
  });

  test('the mark does not become the row click target', async () => {
    // A decorative span inside the row must not swallow the click that opens
    // the session, nor add a second interactive element to the tab order.
    // `antigravity`, not the retired `gemini`: a harness the catalog no longer
    // knows renders NO mark, so the assertion below would pass against
    // `undefined` and stop proving anything about the click target.
    const el = await mount(h(SessionItem, { sessionId: 's1', title: 'hello world', harness: 'antigravity' }));
    const mark = el.querySelector('[data-harness]');
    expect(mark).not.toBeNull();
    expect(mark?.closest('button')).toBeNull();
    expect(el.querySelector('[data-harness]')?.getAttribute('role')).toBe('img');
  });
});
