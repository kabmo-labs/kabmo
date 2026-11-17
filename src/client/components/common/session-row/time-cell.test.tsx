/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timestamp cell's two readings, and the one difference that has to hold
 * between them: the live clock is the row's signal, so it carries a brighter
 * tone than the age it replaces.
 *
 * The tone lives in this cell (not in the callers' class strings) because two
 * `text-ink/NN` utilities in one class list do not override each other — the
 * stylesheet order decides. These assertions are the seam that keeps a caller
 * from reintroducing the resting tone next to the running one.
 *
 * Rendered with `h()` (no JSX) against happy-dom, following
 * `session-row.test.tsx`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionTimeCell } from '@/client/components/common/session-row/TimeCell';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement'] as const;
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

async function mount(props: Parameters<typeof SessionTimeCell>[0]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionTimeCell, props), container);
  });
  return container;
}

describe('session time cell', () => {
  test('at rest draws the age in the dim resting tone', async () => {
    const el = await mount({ timeAgo: '5m', timeTitle: '2026-11-17 10:00', className: 'font-mono text-[10px]' });
    const node = el.querySelector('span');
    expect(node?.textContent).toBe('5m');
    expect(node?.getAttribute('title')).toBe('2026-11-17 10:00');
    expect(node?.classList.contains('text-ink/40')).toBe(true);
    expect(node?.getAttribute('role')).toBeNull();
  });

  test('a live run counts with the brighter tone and never both tones', async () => {
    const el = await mount({
      timeAgo: '5m',
      runStartedAt: Date.now() - 7_000,
      className: 'font-mono text-[10px]',
    });
    const node = el.querySelector('[role="timer"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains('text-ink/80')).toBe(true);
    expect(node?.classList.contains('text-ink/40')).toBe(false);
    expect(node?.getAttribute('aria-label')).toBe('Running for 7s');
  });

  test('a chrome may dim the resting age without touching the running tone', async () => {
    const resting = await mount({
      timeAgo: '5m',
      className: 'font-mono text-[11px]',
      restingClassName: 'text-ink/45',
    });
    expect(resting.querySelector('span')?.classList.contains('text-ink/45')).toBe(true);
    expect(resting.querySelector('span')?.classList.contains('text-ink/40')).toBe(false);

    render(null, resting);
    const running = await mount({
      runStartedAt: Date.now() - 1_000,
      className: 'font-mono text-[11px]',
      restingClassName: 'text-ink/45',
    });
    expect(running.querySelector('[role="timer"]')?.classList.contains('text-ink/80')).toBe(true);
    expect(running.querySelector('[role="timer"]')?.classList.contains('text-ink/45')).toBe(false);
  });

  test('draws nothing when there is neither an age nor a live run', async () => {
    const el = await mount({ timeAgo: null, className: 'font-mono text-[10px]' });
    expect(el.textContent).toBe('');
    expect(el.querySelector('span')).toBeNull();
  });
});
