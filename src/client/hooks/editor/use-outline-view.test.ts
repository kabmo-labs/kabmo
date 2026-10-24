/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The outline hook's two bounds, which no component test can see:
 *
 * - **the scan is DEBOUNCED**, because it walks the whole buffer and the buffer
 *   changes on every keystroke (measured: 704 ms per keystroke at 10 MB with a
 *   live scan, 34 ms without). A declaration list does not change mid-word, so
 *   the rows are recomputed once typing stops;
 * - **a different document scans IMMEDIATELY**, because rows from the previous
 *   file point at lines of a document that is gone;
 * - **a buffer past the scan ceiling is never scanned**, and says why.
 *
 * Rendered with `h()` against happy-dom and driven with FAKE timers: the
 * behaviour under test is a timer, so advancing the clock is the only way to
 * assert it without paying the debounce in every run.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  OUTLINE_SCAN_DELAY_MS,
  useOutlineView,
  type OutlineView,
} from '@/client/hooks/editor/use-outline-view';
import { MAX_OUTLINE_SCAN_CHARS } from '@/shared/lib/code/outline/rows';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
});

afterAll(() => {
  restoreDomGlobals();
});

/** One declaration per `export function`, so a buffer's rows are countable. */
function source(count: number): string {
  return Array.from({ length: count }, (_, i) => `export function fn${i}() {}`).join('\n');
}

interface ProbeProps {
  content: string;
  language?: string;
  path?: string | null;
  state?: 'ready' | 'loading';
  note?: string | null;
}

let latest: OutlineView | null = null;

function Probe({ content, language = 'typescript', path = 'src/a.ts', state = 'ready', note = null }: ProbeProps) {
  latest = useOutlineView({ content, language, path, state, note });
  return h('div', {});
}

async function mount(props: ProbeProps): Promise<void> {
  latest = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Probe, props), container);
  });
}

/** Re-render with new props, then flush Preact's own scheduling. */
async function update(props: ProbeProps): Promise<void> {
  await act(async () => {
    render(h(Probe, props), container);
  });
}

/** Let the debounce fire, plus a tick for the re-render it causes. */
async function settle(): Promise<void> {
  jest.advanceTimersByTime(OUTLINE_SCAN_DELAY_MS);
  await act(async () => {});
}

/** Run the body under fake timers, restoring real ones even on a throw. */
async function withFakeTimers(body: () => Promise<void>): Promise<void> {
  jest.useFakeTimers();
  try {
    await body();
  } finally {
    jest.useRealTimers();
  }
}

describe('useOutlineView', () => {
  test('the first document is outlined on the FIRST render, not one timer later', async () => {
    await mount({ content: source(3) });

    // No `settle()`: a freshly opened file's rows must not arrive late.
    expect(latest?.symbols.map((symbol) => symbol.name)).toEqual(['fn0', 'fn1', 'fn2']);
    expect(latest?.total).toBe(3);
  });

  test('a keystroke does NOT rescan until the buffer goes quiet', async () => {
    await withFakeTimers(async () => {
      await mount({ content: source(2) });
      expect(latest?.total).toBe(2);

      // A new declaration typed in, but the debounce has not elapsed: the rows
      // are still the previous scan's. This is the property that makes typing
      // cheap on a large file.
      await update({ content: source(3) });
      expect(latest?.total).toBe(2);

      await settle();
      expect(latest?.total).toBe(3);
    });
  });

  test('a burst of edits coalesces into ONE scan of the final text', async () => {
    await withFakeTimers(async () => {
      await mount({ content: source(1) });

      for (const count of [2, 3, 4, 5]) {
        await update({ content: source(count) });
        // Shorter than the debounce, so each edit re-arms it.
        jest.advanceTimersByTime(20);
        await act(async () => {});
      }
      // Nothing has landed yet: the last edit re-armed the timer.
      expect(latest?.total).toBe(1);

      await settle();
      expect(latest?.total).toBe(5);
    });
  });

  test('a DIFFERENT document is scanned at once, never on the timer', async () => {
    await mount({ content: source(2), path: 'src/a.ts' });
    expect(latest?.total).toBe(2);

    await update({ content: source(7), path: 'src/b.ts' });
    // No settle: rows from the previous file must not survive a tab switch.
    expect(latest?.total).toBe(7);
    expect(latest?.symbols[0].name).toBe('fn0');
  });

  test('a buffer past the scan ceiling is never scanned, and the notice says why', async () => {
    await withFakeTimers(async () => {
      // One character over the ceiling, without a megabyte of real text.
      const padded = `${source(2)}\n${'x'.repeat(MAX_OUTLINE_SCAN_CHARS)}`;
      await mount({ content: padded });
      await settle();

      expect(latest?.symbols).toEqual([]);
      expect(latest?.total).toBe(0);
      expect(latest?.notice).toContain('too large to outline');
    });
  });

  test('a document that is not ready has no rows, and prints the state sentence', async () => {
    await mount({ content: source(3), state: 'loading' });

    expect(latest?.symbols).toEqual([]);
    expect(latest?.notice).toBe('Reading the file…');
  });

  test('the caller note wins over the state sentence', async () => {
    await mount({ content: '', state: 'ready', note: 'This tab has no outline.' });

    expect(latest?.symbols).toEqual([]);
    expect(latest?.notice).toBe('This tab has no outline.');
  });
});
