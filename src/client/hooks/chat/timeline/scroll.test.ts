/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Chat timeline scroll contract. Both behaviours here were the bug:
 *
 * 1. The jump that follows a session's committed history used the follow-gated
 *    `scrollToBottom`, and follow mode belongs to the mounted view, not to the
 *    session being opened — a user who scrolled up before switching left it
 *    disengaged, so the newly opened session painted at `scrollTop = 0` with no
 *    scroll event to re-engage it and stayed there. Verified live in the
 *    chamber: scroll up in session A, open session B, viewport pinned at the
 *    head with the jump button showing until it was clicked.
 * 2. Nothing re-pinned the tail when content grew while the viewport was
 *    pinned (a prepended window, a late Shiki/mermaid/image layout), so a jump
 *    target measured a frame earlier — or at open time — was stranded.
 *
 * The reading-back hysteresis is its own file (`scroll-reading-back.test.ts`),
 * because the two halves of that contract — the composer shrinking and the
 * threshold that releases it — are a different feature from the follow gate.
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

describe('timeline scroll', () => {
  test('opening a session jumps to the tail even after the user scrolled up', async () => {
    p.scrolled.length = 0;
    p.geometry.top = 0;
    p.geometry.height = 5000;
    const probe = await p.mountProbe('a', [p.message('a1')]);
    const scroll = () => probe.holder.current!;

    await p.updateProbe(probe, 'a', [p.message('a1'), p.message('a2')]);
    expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);

    // The user reads back — follow disengages, and that state outlives the
    // session it was set in.
    probe.el.scrollTop = 100;
    expect(scroll().followRef.current).toBe(false);

    // Session switch: the container paints empty first (the skeleton), the
    // committed history lands a commit later.
    await p.updateProbe(probe, 'b', []);
    p.scrolled.length = 0;
    await p.updateProbe(probe, 'b', [p.message('b1')]);

    expect(scroll().followRef.current).toBe(true);
    expect(p.scrolled.length).toBe(1);
    expect(p.scrolled[0].behavior).toBe('instant');
    expect(p.scrolled[0].top).toBe(p.geometry.height);
    expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);
    await p.unmountProbe(probe);
  });

  test('a stream chunk may not move an unpinned viewport, a jump may', async () => {
    p.scrolled.length = 0;
    p.geometry.top = 0;
    p.geometry.height = 5000;
    const probe = await p.mountProbe('a', [p.message('a1')]);
    const scroll = () => probe.holder.current!;

    await p.act(() => { scroll().jumpToBottom('instant'); });
    expect(scroll().followRef.current).toBe(true);
    expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);
    expect(scroll().jumpCountRef.current).toBe(1);
    expect(scroll().jumpActiveRef.current).toBe(true);

    // The user reads back. A stream chunk must not yank the viewport down...
    probe.el.scrollTop = 100;
    expect(scroll().followRef.current).toBe(false);
    p.scrolled.length = 0;
    await p.act(() => { scroll().scrollToBottom('smooth'); });
    expect(p.scrolled.length).toBe(0);

    // ...while the explicit jump bypasses the gate and re-engages it.
    await p.act(() => { scroll().jumpToBottom('instant'); });
    expect(p.scrolled.length).toBe(1);
    expect(scroll().followRef.current).toBe(true);
    expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);
    expect(scroll().jumpCountRef.current).toBe(2);
    await p.unmountProbe(probe);
  });

  test('the jump guard releases so history paging is not blocked for good', async () => {
    p.scrolled.length = 0;
    p.geometry.top = 0;
    p.geometry.height = 5000;
    const probe = await p.mountProbe('a', [p.message('a1')]);
    const scroll = () => probe.holder.current!;

    fakeTimers.useFakeTimers();
    await p.act(() => { scroll().jumpToBottom('instant'); });
    expect(scroll().jumpActiveRef.current).toBe(true);

    await p.act(() => { fakeTimers.advanceTimersByTime(1000); });
    expect(scroll().jumpActiveRef.current).toBe(false);
    fakeTimers.useRealTimers();
    await p.unmountProbe(probe);
  });

  test('content growing while pinned re-pins the tail; while reading it does not', async () => {
    p.scrolled.length = 0;
    p.geometry.top = 0;
    p.geometry.height = 5000;
    const probe = await p.mountProbe('a', [p.message('a1')]);
    const scroll = () => probe.holder.current!;

    await p.updateProbe(probe, 'a', [p.message('a1')]);
    expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);

    // A prepended window / a late layout: the tail moved down by 800px.
    p.geometry.height += 800;
    const observer = p.StubResizeObserver.latest();
    p.scrolled.length = 0;
    await p.act(() => { observer.fire(); });
    // The delivery itself writes nothing — that is the loop fix.
    expect(p.scrolled.length).toBe(0);
    await p.flushFrames();
    expect(p.scrolled.length).toBe(1);
    expect(p.scrolled[0].behavior).toBe('instant');
    expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);

    // Reading back: the same growth must leave the viewport alone.
    probe.el.scrollTop = 400;
    p.scrolled.length = 0;
    p.geometry.height += 800;
    await p.act(() => { p.StubResizeObserver.latest().fire(); });
    await p.flushFrames();
    expect(p.scrolled.length).toBe(0);
    expect(probe.el.scrollTop).toBe(400);
    expect(scroll().followRef.current).toBe(false);
    await p.unmountProbe(probe);
  });

  test('a delivery storm collapses to one pin, and none of them writes inside the delivery', async () => {
    p.scrolled.length = 0;
    p.geometry.top = 0;
    p.geometry.height = 5000;
    const probe = await p.mountProbe('a', [p.message('a1')]);

    await p.updateProbe(probe, 'a', [p.message('a1')]);
    p.scrolled.length = 0;

    // A panel-width transition delivers a new box every frame. Each delivery
    // used to write `scrollTop` synchronously, which is what made the browser
    // re-run its observers within the frame and eventually report a
    // ResizeObserver loop; the deferred pin coalesces the whole burst into one.
    const observer = p.StubResizeObserver.latest();
    p.geometry.height += 800;
    await p.act(() => { observer.fire(); });
    p.geometry.height += 800;
    await p.act(() => { observer.fire(); });
    p.geometry.height += 800;
    await p.act(() => { observer.fire(); });
    expect(p.scrolled.length).toBe(0);

    await p.flushFrames();
    expect(p.scrolled.length).toBe(1);
    expect(probe.el.scrollTop).toBe(p.geometry.height - p.geometry.viewport);
    await p.unmountProbe(probe);
  });
});
