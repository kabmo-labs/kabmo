/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The deferred-highlight hook, and the idle scheduler under it.
 *
 * The property that matters is the one the user feels: the FIRST render after a
 * tap must not run the tokenizer. A card that appeared only after 220–300 ms of
 * grammar work (measured at 4× CPU; 730–1484 ms at 20×) is the delay this
 * exists to remove, and a hook that highlighted synchronously "sometimes" would
 * pass a markup assertion and fail the point.
 *
 * So the scheduler is injectable here — the same seam the warm-up and the
 * grammar loader use — and the assertions are about WHEN the compute ran, not
 * only about what it produced. No wall-clock waits: the fallback path is driven
 * by fake timers.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useDeferredHighlight } from '@/client/hooks/code/deferred-highlight';
import { scheduleIdle } from '@/shared/lib/code/idle';
import { clearHighlightMemo, highlightMemoSize } from '@/shared/lib/code/highlight-memo';
import { resetTokenizerWarmup, warmSyntaxTokenizers } from '@/shared/lib/code/highlighter-warmup';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  clearHighlightMemo();
  resetTokenizerWarmup();
});

describe('scheduleIdle', () => {
  test('a runtime without requestIdleCallback still runs the work', () => {
    const host = globalThis as unknown as Record<string, unknown>;
    const saved = host.requestIdleCallback;
    delete host.requestIdleCallback;
    vi.useFakeTimers();
    try {
      let runs = 0;
      scheduleIdle(() => { runs += 1; });
      vi.advanceTimersByTime(1);
      expect(runs).toBe(1);
    } finally {
      vi.useRealTimers();
      if (saved !== undefined) host.requestIdleCallback = saved;
    }
  });

  test('cancelling before the slice fires skips the work', () => {
    const host = globalThis as unknown as Record<string, unknown>;
    const saved = host.requestIdleCallback;
    delete host.requestIdleCallback;
    vi.useFakeTimers();
    try {
      let runs = 0;
      const cancel = scheduleIdle(() => { runs += 1; });
      cancel();
      vi.advanceTimersByTime(1);
      expect(runs).toBe(0);
    } finally {
      vi.useRealTimers();
      if (saved !== undefined) host.requestIdleCallback = saved;
    }
  });
});

describe('warmSyntaxTokenizers', () => {
  test('tokenizes one sample per language, one slice at a time', () => {
    const calls: Array<{ language: string; code: string }> = [];
    const queue: Array<() => void> = [];
    warmSyntaxTokenizers({
      languages: ['typescript', 'bash'],
      ready: () => true,
      highlight: (code, language) => calls.push({ language, code }),
      schedule: (run) => {
        queue.push(run);
        return () => {};
      },
    });

    // One slice is armed, not the whole set: a slow grammar must not become the
    // long task this exists to prevent.
    expect(queue).toHaveLength(1);
    act(() => queue.shift()!());
    expect(calls.map((c) => c.language)).toEqual(['typescript']);
    expect(queue).toHaveLength(1);
    act(() => queue.shift()!());
    expect(calls.map((c) => c.language)).toEqual(['typescript', 'bash']);
  });

  test('is a no-op the second time, so a re-evaluated entry cannot re-warm', () => {
    let calls = 0;
    const options = {
      languages: ['typescript'],
      ready: () => true,
      highlight: () => { calls += 1; },
      schedule: (run: () => void) => { run(); return () => {}; },
    };
    warmSyntaxTokenizers(options);
    warmSyntaxTokenizers(options);
    expect(calls).toBe(1);
  });

  test('a grammar that has not landed is retried rather than skipped', () => {
    const calls: string[] = [];
    let ready = false;
    const queue: Array<() => void> = [];
    warmSyntaxTokenizers({
      languages: ['typescript'],
      ready: () => ready,
      highlight: (_code, language) => calls.push(language),
      schedule: (run) => {
        queue.push(run);
        return () => {};
      },
    });

    act(() => queue.shift()!());
    expect(calls).toEqual([]);
    ready = true;
    act(() => queue.shift()!());
    expect(calls).toEqual(['typescript']);
  });
});

describe('the deferred render', () => {
  test('draws the escaped source without tokenizing on the mounting tick', async () => {
    let renders = 0;
    function Card({ code }: { code: string }) {
      const html = useDeferredHighlight(code, 'typescript');
      renders += 1;
      return h('pre', { dangerouslySetInnerHTML: { __html: html } });
    }

    await act(async () => {
      render(h(Card, { code: 'const value = 1;' }), container);
    });

    // Nothing has been tokenized on this tick — the tap's own task is clean.
    expect(highlightMemoSize()).toBe(0);
    expect(renders).toBeGreaterThan(0);
    // What it DID draw is the escaped source, not an empty box.
    expect(container.textContent).toContain('const value = 1;');
  });

  test('empty input renders nothing and caches nothing', async () => {
    function Card() {
      return h('pre', { dangerouslySetInnerHTML: { __html: useDeferredHighlight('', 'typescript') } });
    }
    await act(async () => {
      render(h(Card, {}), container);
    });
    expect(highlightMemoSize()).toBe(0);
  });
});
