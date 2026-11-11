/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The full-reload beat: it fires on the interval, and stops when the mount
 * goes away. A live timer after unmount is what keeps a list re-reading from a
 * component nobody is looking at.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SIDEBAR_FULL_RELOAD_MS, useSidebarFullReload } from '@/client/hooks/chat/omp/sidebar-reload';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
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
  container.remove();
});

afterEach(() => {
  vi.useRealTimers();
});

function mount(refresh: () => void): void {
  function Probe() {
    useSidebarFullReload(refresh);
    return null;
  }
  act(() => {
    render(h(Probe, null), container);
  });
}

describe('useSidebarFullReload', () => {
  test('refreshes once per interval, not before it', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    mount(refresh);

    vi.advanceTimersByTime(SIDEBAR_FULL_RELOAD_MS - 1);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SIDEBAR_FULL_RELOAD_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  test('stops the beat when the mount goes away', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    mount(refresh);

    act(() => {
      render(null, container);
    });
    vi.advanceTimersByTime(SIDEBAR_FULL_RELOAD_MS * 3);

    expect(refresh).not.toHaveBeenCalled();
  });
});
