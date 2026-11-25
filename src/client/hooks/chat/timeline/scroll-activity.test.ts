/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Auto-follow while the reader is USING the transcript.
 *
 * The stream's tail pin is not allowed to move the viewport under a pointer
 * that is selecting text, hovering a row or reaching for a control. Activity is
 * a window: the first chunk after the pointer goes idle catches the tail up, so
 * a stray pass cannot suppress the rest of the run. The two signals stay
 * separate — pointer travel is ACTIVITY, never scroll intent, or every layout
 * clamp that happened during a hover would read as the reader scrolling back.
 *
 * The follow gate and the idle re-pin live in `scroll.test.ts`; all three files
 * share `scroll-probe.test-util.ts`.
 */

import { afterAll, beforeAll, describe, expect, jest as fakeTimers, test } from 'bun:test';
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

describe('timeline reader activity', () => {
  test('auto-follow waits while the pointer is on the transcript, then catches up', async () => {
    fakeTimers.useFakeTimers();
    try {
      p.scrolled.length = 0;
      p.geometry.top = 0;
      p.geometry.height = 5000;
      p.geometry.viewport = 500;
      const probe = await p.mountProbe('a', [p.message('a1')]);
      const scroll = () => probe.holder.current!;
      await p.act(() => { scroll().jumpToBottom('instant'); });
      await p.flushFrames(8);
      expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);

      // The pointer moves over the transcript (picking text, hovering a row).
      await p.act(() => { probe.el.dispatchEvent(new Event('pointermove')); });
      p.scrolled.length = 0;

      // A stream chunk must not pin the tail while the pointer is active.
      p.geometry.height += 400;
      await p.act(() => { scroll().scrollToBottom('instant'); });
      expect(p.scrolled.length).toBe(0);
      expect(probe.el.scrollTop).toBe(5000 - 500);

      // Nor may content growth do it through the geometry observer.
      p.StubResizeObserver.latest().fire();
      await p.flushFrames(2);
      expect(p.scrolled.length).toBe(0);
      expect(scroll().followRef.current).toBe(true);

      // A press keeps the gate up past the idle window: a drag that leaves the
      // transcript still owns the viewport.
      await p.act(() => { probe.el.dispatchEvent(new Event('pointerdown')); });
      await p.act(() => { fakeTimers.advanceTimersByTime(700); });
      await p.act(() => { scroll().scrollToBottom('instant'); });
      expect(p.scrolled.length).toBe(0);

      // Released, then idle: the next chunk catches the tail up.
      await p.act(() => { window.dispatchEvent(new Event('pointerup')); });
      await p.act(() => { fakeTimers.advanceTimersByTime(700); });
      await p.act(() => { scroll().scrollToBottom('instant'); });
      expect(p.scrolled.length).toBe(1);
      expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);
      await p.unmountProbe(probe);
    } finally {
      fakeTimers.useRealTimers();
    }
  });

  test('pointer travel is activity, never scroll intent', async () => {
    p.scrolled.length = 0;
    p.geometry.top = 0;
    p.geometry.height = 5000;
    p.geometry.viewport = 500;
    const probe = await p.mountProbe('b', [p.message('b1')]);
    const scroll = () => probe.holder.current!;
    await p.act(() => { scroll().jumpToBottom('instant'); });
    expect(scroll().followRef.current).toBe(true);

    // A measurement replacing an estimate moves the viewport up while the
    // pointer happens to be over the transcript. That is a CLAMP, not the
    // reader taking the viewport back: follow must stay engaged.
    await p.act(() => { probe.el.dispatchEvent(new Event('pointermove')); });
    probe.el.scrollTop = p.geometry.height - p.geometry.viewport - 300;
    expect(scroll().followRef.current).toBe(true);
    await p.unmountProbe(probe);
  });
});
