/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's narrow verdict.
 *
 * Two things are invisible without pinning them: the BOUNDARY (a card exactly at
 * the threshold keeps the desktop labels — one pixel under it, the phone
 * arrangement), and the fact that the verdict is measured from the CARD rather
 * than the window, so a 1440px desktop with a dragged-in chat column still
 * answers "narrow". The third case is the one a naive `ResizeObserver` gets
 * wrong: a card that reports 0 (inside a hidden panel) must keep its desktop
 * arrangement instead of redrawing icon-only the moment it appears.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  COMPOSER_NARROW_MAX_WIDTH_PX,
  resolveComposerNarrow,
  useComposerNarrow,
} from '@/client/hooks/chat/composer/narrow';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

/** The runner's own observer, put back after every case. */
const nativeResizeObserver = globalThis.ResizeObserver;

let container: HTMLElement | undefined;

/** Every observer this file's components created, so a case can fire one. */
let observers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  static latest: FakeResizeObserver | null = null;
  targets: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
    observers.push(this);
    FakeResizeObserver.latest = this;
  }
  observe(target: Element) {
    this.targets.push(target);
    // A real observer delivers its first measurement on the next frame; the
    // cases fire explicitly instead, so "narrow" is only true when they say so.
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire(width: number) {
    this.callback([{ contentRect: { width } }]);
  }
}

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver;
  observers = [];
  FakeResizeObserver.latest = null;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  if (nativeResizeObserver === undefined) {
    delete (globalThis as unknown as Record<string, unknown>).ResizeObserver;
  } else {
    (globalThis as unknown as Record<string, unknown>).ResizeObserver = nativeResizeObserver;
  }
  restoreDomGlobals();
});

describe('resolveComposerNarrow', () => {
  test('a card narrower than the threshold takes the phone arrangement', () => {
    expect(resolveComposerNarrow(COMPOSER_NARROW_MAX_WIDTH_PX - 1)).toBe(true);
    expect(resolveComposerNarrow(320)).toBe(true);
  });

  test('the threshold itself keeps the desktop labels', () => {
    expect(resolveComposerNarrow(COMPOSER_NARROW_MAX_WIDTH_PX)).toBe(false);
    expect(resolveComposerNarrow(1200)).toBe(false);
  });

  test('an unmeasurable card (0) is not narrow', () => {
    expect(resolveComposerNarrow(0)).toBe(false);
  });
});

describe('useComposerNarrow', () => {
  test('follows the CARD width, so a wide window with a narrow column still folds', async () => {
    const seen: boolean[] = [];
    function Probe() {
      const narrow = useComposerNarrow({ current: null });
      seen.push(narrow);
      return h('span', null, narrow ? 'narrow' : 'wide');
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { render(h(Probe, null), container!); });
    expect(container.textContent).toBe('wide');
    expect(seen.length).toBeGreaterThan(0);
  });

  test('flips on the observer’s measurement and disconnects on unmount', async () => {
    function Probe() {
      const narrow = useComposerNarrow({ current: document.body });
      return h('span', null, narrow ? 'narrow' : 'wide');
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { render(h(Probe, null), container!); });
    const observer = FakeResizeObserver.latest;
    expect(observer).not.toBeNull();
    expect(container.textContent).toBe('wide');

    await act(async () => { observer!.fire(400); });
    expect(container.textContent).toBe('narrow');

    await act(async () => { observer!.fire(900); });
    expect(container.textContent).toBe('wide');

    await act(async () => { render(null, container!); });
    expect(observer!.disconnected).toBe(true);
  });
});
