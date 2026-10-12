/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop session row's rename cue, and the slot rule it has to obey.
 *
 * The row owns ONE 16px slot, and it hands it to a live cue in priority order
 * (rename → blocked-on-a-question → run spinner → settled check), falling back
 * to the roster chevron when nothing is live. A rename is the newest occupant
 * and the one that overlaps the chevron most often: the row the user just acted
 * on is very often a session with a subagent roster, so a slot rule that only
 * knew about the run cue left the chevron pinned on top of the spinner.
 *
 * Rendered with `h()` (no JSX) against happy-dom, following the harness in
 * `mobile-session-sidebar/SessionRow.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionItem } from '@/client/components/layout/session-sidebar/SessionItem';
import type { SessionItemProps } from '@/client/components/layout/session-sidebar/SessionItem';
import { setSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';

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
  setSessionRenaming('s1', false);
});

async function mount(overrides: Partial<SessionItemProps> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionItem, { sessionId: 's1', title: 'hello world', ...overrides }), container);
  });
  return container;
}

function renameCue(el: HTMLElement): Element | null {
  return el.querySelector('[role="status"]');
}

describe('desktop session row rename cue', () => {
  test('draws a labelled spinner while the rename is in flight', async () => {
    setSessionRenaming('s1', true);
    const el = await mount();
    const cue = renameCue(el);
    expect(cue?.getAttribute('aria-label')).toBe('Generating a name…');
    expect(cue?.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
  });

  test('a row that has never been renamed draws none', async () => {
    const el = await mount();
    expect(renameCue(el)).toBeNull();
  });

  test('takes the slot from a roster chevron, which is hidden until hover', async () => {
    setSessionRenaming('s1', true);
    const el = await mount({
      hasSubagents: true,
      expandable: true,
      onToggleExpand: () => {},
    });
    expect(renameCue(el)).not.toBeNull();
    // `chevronPinned` is false, so the chevron carries the hover-reveal
    // classes rather than the pinned ink — the row is not showing two glyphs
    // in one slot at rest.
    const chevron = el.querySelector('button[aria-expanded]');
    expect(chevron?.getAttribute('class')).toContain('pointer-events-none');
  });

  test('outranks the run spinner', async () => {
    setSessionRenaming('s1', true);
    const el = await mount({ status: 'stream' });
    expect(renameCue(el)).not.toBeNull();
    expect(el.querySelectorAll('[role="status"]').length).toBe(1);
  });
});
