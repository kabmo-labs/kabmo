/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The jump rail's follow-mode handoff.
 *
 * A rail click must survive the paging it triggers. Reaching an early turn
 * prepends ~300 rows per window above the viewport, and while `followRef` is
 * true the scroll hook's content observer re-pins to the tail — so the
 * viewport lands back where it started and the click looks like it did
 * nothing. Behaviours that are load-bearing, each measured in the browser
 * before being pinned here:
 *
 *  - the flag goes off SYNCHRONOUSLY, before the prepends start;
 *  - it is HELD off while the viewport is still moving (a scroll handler that
 *    re-engages near the tail would otherwise flip it straight back);
 *  - it is RELEASED once the viewport settles, or a jump to the newest turn
 *    would silently stop following the stream.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useRailJump, type RailJumpRefs } from '@/client/hooks/chat/timeline/rail-jump';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

/** A frame clock the test drives by hand, so no case waits on wall time. */
interface FrameClock {
  /** Run every frame callback currently queued, layer by layer. */
  drain(): void;
  /** Advance exactly ONE frame — one layer of callbacks. */
  step(): void;
  restore(): void;
}

function installFrameClock(): FrameClock {
  const original = globalThis.requestAnimationFrame;
  let queue: (() => void)[] = [];
  globalThis.requestAnimationFrame = ((cb: () => void): number => {
    queue.push(cb);
    return queue.length;
  }) as typeof requestAnimationFrame;
  return {
    step(): void {
      const pending = queue;
      queue = [];
      for (const cb of pending) cb();
    },
    drain(): void {
      for (let i = 0; i < 40 && queue.length > 0; i += 1) {
        const pending = queue;
        queue = [];
        for (const cb of pending) cb();
      }
    },
    restore(): void {
      globalThis.requestAnimationFrame = original;
    },
  };
}

let clock: FrameClock | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  clock?.restore();
  clock = undefined;
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

interface Harness {
  followRef: { current: boolean };
  el: { scrollTop: number };
  jump: (id: string, index: number) => Promise<boolean>;
  calls: () => Array<[string, number]>;
}

/** Mount the hook and hand back the refs it was given, so a case can play the
 *  part of the scroll handler (movement + re-engage) frame by frame. */
async function mount(opts: { scrollTop?: number; reached?: boolean } = {}): Promise<Harness> {
  const followRef = { current: true };
  const el = { scrollTop: opts.scrollTop ?? 0 };
  const scrollRef = { current: el as unknown as HTMLDivElement };
  const calls: Array<[string, number]> = [];
  const jump = (id: string, index: number): Promise<boolean> => {
    calls.push([id, index]);
    return Promise.resolve(opts.reached ?? true);
  };
  const refs: RailJumpRefs = { followRef, scrollRef };
  let callback: ((id: string, index: number) => Promise<boolean>) | undefined;
  function Probe() {
    callback = useRailJump(jump, refs);
    return null;
  }
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(Probe, {}), container as HTMLElement); });
  return {
    followRef,
    el,
    jump: (id, index) => callback!(id, index),
    calls: () => calls,
  };
}

describe('useRailJump', () => {
  test('disengages follow mode synchronously, before any paging can start', async () => {
    clock = installFrameClock();
    const harness = await mount();
    expect(harness.followRef.current).toBe(true);
    void harness.jump('u1', 3);
    // The prepends happen inside the jump; the flag must already be off.
    expect(harness.followRef.current).toBe(false);
    expect(harness.calls()).toEqual([['u1', 3]]);
  });

  test('holds the flag off while the viewport is still moving', async () => {
    clock = installFrameClock();
    const harness = await mount();
    void harness.jump('u1', 3);
    // Each frame the paging moves the viewport; the scroll handler would flip
    // the flag back on every one of those prepends.
    for (const top of [100, 500, 900]) {
      harness.el.scrollTop = top;
      harness.followRef.current = true;
      clock.step();
      expect(harness.followRef.current).toBe(false);
    }
  });

  test('releases the flag once the viewport settles, so a jump to the newest turn resumes following', async () => {
    clock = installFrameClock();
    const harness = await mount();
    void harness.jump('u1', 3);
    harness.el.scrollTop = 900;
    // Settled: the hold returns and stops touching the flag.
    clock.drain();
    expect(harness.followRef.current).toBe(false);
    // The scroll handler's own rule re-engages at the tail — the hold must not
    // be running to fight it.
    harness.followRef.current = true;
    clock.drain();
    expect(harness.followRef.current).toBe(true);
  });

  test('a jump whose row was never reached still releases the hold', async () => {
    clock = installFrameClock();
    const harness = await mount({ reached: false });
    const returned = harness.jump('u9', 40);
    clock.drain();
    expect(harness.followRef.current).toBe(false);
    expect(await returned).toBe(false);
  });

  test('passes the turn through to the paging walk and returns its answer', async () => {
    clock = installFrameClock();
    const harness = await mount();
    expect(await harness.jump('u7', 12)).toBe(true);
    expect(harness.calls()).toEqual([['u7', 12]]);
  });

  test('a viewport that never settles stops at the frame ceiling instead of spinning', async () => {
    clock = installFrameClock();
    const harness = await mount();
    void harness.jump('u1', 3);
    // Every frame moves the viewport, so the settle test can never pass: the
    // hold must end on its own bound rather than loop forever.
    for (let i = 0; i < 700; i += 1) {
      harness.el.scrollTop = i;
      harness.followRef.current = true;
      clock.drain();
    }
    // Past the ceiling the hold no longer re-asserts the flag.
    harness.followRef.current = true;
    clock.drain();
    expect(harness.followRef.current).toBe(true);
  });
});
