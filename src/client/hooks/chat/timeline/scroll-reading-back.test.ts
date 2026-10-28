/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timeline's reading-back hysteresis, which is what a phone composer
 * shrinks on.
 *
 * It is hysteretic for a reason the geometry makes unavoidable: compacting the
 * composer GROWS the scroller's viewport by the height it gave back, which
 * moves the reader CLOSER to the tail. A single threshold would then release
 * the flag, restore the box, and push the reader back out — a render loop.
 *
 * The follow gate and the deferred re-pin live in `scroll.test.ts`; both files
 * share `scroll-probe.test-util.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ScrollProbe } from '@/client/hooks/chat/timeline/scroll-probe.test-util';

let p: ScrollProbe;

beforeAll(async () => {
  // Dynamic: the harness installs the DOM globals BEFORE Preact and the hooks
  // evaluate, which a static import would pre-empt (see the harness header).
  const { setupScrollProbe } = await import('@/client/hooks/chat/timeline/scroll-probe.test-util');
  p = await setupScrollProbe();
});

afterAll(() => {
  p.teardown();
});

describe('timeline reading back', () => {
  test('readingBack engages further back than the jump button and releases at the tail', async () => {
    p.scrolled.length = 0;
    p.geometry.top = 0;
    p.geometry.height = 5000;
    const probe = await p.mountProbe('a', [p.message('a1')]);
    const scroll = () => probe.holder.current!;
    /** Both flags are state, so the commit that carries them is a render. */
    const readAt = async (top: number) => {
      await p.act(() => { probe.el.scrollTop = top; });
      return { jump: scroll().showScrollBottom, compact: scroll().readingBack };
    };
    const tail = p.geometry.height - p.geometry.viewport;

    // At the tail: neither flag.
    expect(await readAt(tail)).toEqual({ jump: false, compact: false });

    // Past the jump-button threshold but short of the compaction one: the
    // button is offered, the composer is NOT shrunk.
    expect(await readAt(tail - 150)).toEqual({ jump: true, compact: false });

    // Further back: both.
    expect(await readAt(tail - 400)).toEqual({ jump: true, compact: true });

    // Coming back: the composer stays shrunk through the jump-button window,
    // so the 24px a compaction gives back cannot release it.
    expect(await readAt(tail - 150)).toEqual({ jump: true, compact: true });

    // The tail releases it.
    expect(await readAt(tail)).toEqual({ jump: false, compact: false });
    await p.unmountProbe(probe);
  });
});
