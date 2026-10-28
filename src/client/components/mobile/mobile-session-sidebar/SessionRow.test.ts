/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mobile session row's status slot.
 *
 * The phone must draw the same cue the desktop row does: a session whose agent
 * is blocked on a question shows the question mark, NOT the run spinner. The
 * child is still mid-run while it waits (`streamStatus` stays `stream`), so a
 * row that only knew the stream state drew a spinner over a turn that was
 * actually waiting for the user — the bug this pins.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MobileSessionRow } from '@/client/components/mobile/mobile-session-sidebar/SessionRow';
import type { MobileSessionRowProps } from '@/client/components/mobile/mobile-session-sidebar/SessionRow';
import { setSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import type { SessionItemData } from '@/shared/types';

let container: HTMLElement;

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

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

const session: SessionItemData = { id: 's1', folder_id: 1, title: 'hello world' };

async function mount(overrides: Partial<MobileSessionRowProps>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(MobileSessionRow, {
      session,
      isActive: false,
      timeAgo: '1m',
      onSelect: () => {},
      onArchive: () => {},
      ...overrides,
    }), container);
  });
  return container;
}

function svgClasses(el: HTMLElement) {
  return Array.from(el.querySelectorAll('svg')).map((s) => s.getAttribute('class') ?? '').join('|');
}

describe('mobile session row status slot', () => {
  test('awaiting input beats the stream spinner', async () => {
    const el = await mount({ status: 'stream', awaitingInput: true });
    expect(svgClasses(el)).toContain('circle-question-mark');
    expect(svgClasses(el)).not.toContain('animate-spin');
  });

  test('stream alone still spins', async () => {
    const el = await mount({ status: 'stream' });
    expect(svgClasses(el)).toContain('animate-spin');
    expect(svgClasses(el)).not.toContain('circle-question-mark');
  });

  test('terminal badge draws the check', async () => {
    const el = await mount({ status: 'finish' });
    expect(svgClasses(el)).toContain('lucide-check');
  });

  test('no status draws no glyph', async () => {
    const el = await mount({});
    const slot = el.querySelector('span.w-4');
    expect(slot?.querySelector('svg')).toBeNull();
  });
});

/**
 * The rename cue. It is not a run state — it is the answer to a click that is
 * still pending — so it must draw over a row that has no status at all, and it
 * must outrank the run cue for the instant the server's mid-run refusal is in
 * flight. Both directions are asserted against the store the row reads, because
 * a row that kept its own flag would show nothing here.
 */
describe('mobile session row rename cue', () => {
  afterEach(() => setSessionRenaming('s1', false));

  test('spins, with an accessible name, while the rename is in flight', async () => {
    setSessionRenaming('s1', true);
    const el = await mount({});
    const status = el.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-label')).toBe('Generating a name…');
    expect(status?.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
  });

  test('outranks the stream spinner and the terminal check', async () => {
    setSessionRenaming('s1', true);
    const streaming = await mount({ status: 'stream' });
    expect(streaming.querySelectorAll('[role="status"]').length).toBe(1);

    setSessionRenaming('s1', false);
    const settled = await mount({ status: 'finish' });
    expect(settled.querySelector('[role="status"]')).toBeNull();
    expect(svgClasses(settled)).toContain('lucide-check');
  });
});
