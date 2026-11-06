/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The short-lived feedback flags: the copy confirmation and the "show more" page
 * size. The toast queue has its own suite (`toast-queue.test.ts`).
 *
 * Each case pins a stale flag. The copy confirmation restarts a timer on a
 * repeat trigger — without the clearTimeout the first timer still fires and the
 * check mark disappears while the user is copying the next item. "Show more"
 * must keep counting past the list length (the hook has no total to clamp
 * against; callers slice).
 *
 * Mounted with `h()` against happy-dom, the same way the other hook tests do.
 * The overlay-scrollbar fade lives in `lib/scrollbar-activity.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useCopyFlag } from '@/client/hooks/ui/copy-flag';
import { useShowMore } from '@/client/hooks/ui/show-more';
import type { ShowMore } from '@/client/hooks/ui/show-more';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown (see the matching afterAll at the end of this file) so later files still see native Event/CustomEvent/window. */
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

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  jest.useRealTimers();
});

function mount(vnode: Parameters<typeof render>[0]) {
  container ??= document.body.appendChild(document.createElement('div'));
  act(() => {
    render(vnode, container as HTMLElement);
  });
}

/** The return contract of the hook here that exports no named type. */
interface CopyFlagApi {
  copied: boolean;
  flagCopied: () => void;
}

function CopyProbe({ resetMs, seen }: { resetMs: number; seen: { current: CopyFlagApi | null } }) {
  seen.current = useCopyFlag(resetMs);
  return h('span', null, seen.current.copied ? 'copied' : 'idle');
}

describe('useCopyFlag', () => {
  test('turns the flag on immediately and off after exactly resetMs', () => {
    jest.useFakeTimers();
    const seen: { current: CopyFlagApi | null } = { current: null };
    mount(h(CopyProbe, { resetMs: 100, seen }));

    expect(seen.current!.copied).toBe(false);
    act(() => seen.current!.flagCopied());
    expect(seen.current!.copied).toBe(true);

    // One millisecond short of the reset: still lit.
    act(() => {
      jest.advanceTimersByTime(99);
    });
    expect(seen.current!.copied).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(seen.current!.copied).toBe(false);
  });

  test('a second copy restarts the reset window instead of inheriting the first', () => {
    jest.useFakeTimers();
    const seen: { current: CopyFlagApi | null } = { current: null };
    mount(h(CopyProbe, { resetMs: 100, seen }));

    act(() => seen.current!.flagCopied());
    act(() => {
      jest.advanceTimersByTime(80);
    });
    // Re-copy at 80ms; the first timer would have fired at 100ms.
    act(() => seen.current!.flagCopied());
    act(() => {
      jest.advanceTimersByTime(80);
    });
    expect(seen.current!.copied).toBe(true);
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(seen.current!.copied).toBe(false);
  });

  test('the reset delay is the one the hook was mounted with', () => {
    jest.useFakeTimers();
    const seen: { current: CopyFlagApi | null } = { current: null };
    mount(h(CopyProbe, { resetMs: 500, seen }));

    act(() => seen.current!.flagCopied());
    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(seen.current!.copied).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(seen.current!.copied).toBe(false);
  });

  test('a pending reset is dropped on unmount', () => {
    jest.useFakeTimers();
    const seen: { current: CopyFlagApi | null } = { current: null };
    mount(h(CopyProbe, { resetMs: 100, seen }));
    act(() => seen.current!.flagCopied());

    render(null, container as HTMLElement);
    // The timer was cleared, so nothing is left queued to fire.
    expect(jest.getTimerCount()).toBe(0);
  });
});

function ShowMoreProbe({ initial, step, seen }: { initial?: number; step?: number; seen: { current: ShowMore | null } }) {
  seen.current = useShowMore(initial, step);
  return h('span', null, String(seen.current.visibleCount));
}

describe('useShowMore', () => {
  test('starts at five and grows by seven per click', () => {
    const seen: { current: ShowMore | null } = { current: null };
    mount(h(ShowMoreProbe, { seen }));

    expect(seen.current!.visibleCount).toBe(5);
    act(() => seen.current!.showMore());
    expect(seen.current!.visibleCount).toBe(12);
    act(() => seen.current!.showMore());
    expect(seen.current!.visibleCount).toBe(19);
  });

  test('honours a custom initial and step', () => {
    const seen: { current: ShowMore | null } = { current: null };
    mount(h(ShowMoreProbe, { initial: 0, step: 3, seen }));

    expect(seen.current!.visibleCount).toBe(0);
    act(() => seen.current!.showMore());
    expect(seen.current!.visibleCount).toBe(3);
  });

  test('keeps counting past any list length — it has no total to clamp against', () => {
    const seen: { current: ShowMore | null } = { current: null };
    mount(h(ShowMoreProbe, { initial: 5, step: 7, seen }));

    for (let i = 0; i < 20; i += 1) act(() => seen.current!.showMore());
    expect(seen.current!.visibleCount).toBe(5 + 20 * 7);
  });

  test('a re-render with a new step uses the new increment', () => {
    const seen: { current: ShowMore | null } = { current: null };
    mount(h(ShowMoreProbe, { initial: 5, step: 7, seen }));
    act(() => seen.current!.showMore());
    expect(seen.current!.visibleCount).toBe(12);

    mount(h(ShowMoreProbe, { initial: 5, step: 1, seen }));
    act(() => seen.current!.showMore());
    expect(seen.current!.visibleCount).toBe(13);
  });

  test('canShowLess is false until the window grows, and showLess collapses to the initial size', () => {
    const seen: { current: ShowMore | null } = { current: null };
    mount(h(ShowMoreProbe, { seen }));
    expect(seen.current!.canShowLess).toBe(false);

    act(() => seen.current!.showMore());
    act(() => seen.current!.showMore());
    expect(seen.current!.visibleCount).toBe(19);
    expect(seen.current!.canShowLess).toBe(true);

    // One click closes whatever several opened — the whole point of the
    // separate control.
    act(() => seen.current!.showLess());
    expect(seen.current!.visibleCount).toBe(5);
    expect(seen.current!.canShowLess).toBe(false);
  });

  test('showLess returns to the hook\'s own initial, not a hardcoded five', () => {
    const seen: { current: ShowMore | null } = { current: null };
    mount(h(ShowMoreProbe, { initial: 2, step: 4, seen }));
    act(() => seen.current!.showMore());
    expect(seen.current!.visibleCount).toBe(6);
    act(() => seen.current!.showLess());
    expect(seen.current!.visibleCount).toBe(2);
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});
