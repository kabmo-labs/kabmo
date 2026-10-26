/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The range an "in selection" search is restricted to.
 *
 * The rule is capture-on-arm: a range the user then MOVES must not change what is being
 * searched, because the toggle says "the text I had selected". Arming with nothing selected
 * answers false, so the caller can refuse to turn the toggle on rather than promise a
 * restriction it cannot apply.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useSelectionRange, type FindSelectionRange } from '@/client/hooks/editor/find-selection-range';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const win = new Window({ url: 'http://localhost' });
for (const key of DOM_GLOBALS) {
  const target = globalThis as unknown as Record<string, unknown>;
  native[key] = target[key];
  target[key] = (win as unknown as Record<string, unknown>)[key];
}

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = native[key];
});

function mount(): { api: () => FindSelectionRange; unmount: () => void } {
  let slot: FindSelectionRange | null = null;
  function Probe() {
    slot = useSelectionRange();
    return null;
  }
  const host = document.createElement('div');
  render(h(Probe, {}), host);
  return {
    api: () => {
      if (!slot) throw new Error('not mounted');
      return slot;
    },
    unmount: () => render(null, host),
  };
}

describe('useSelectionRange', () => {
  test('starts with no range', () => {
    const { api, unmount } = mount();
    expect(api().range).toBeNull();
    unmount();
  });

  test('arming captures the selection it was given', () => {
    const { api, unmount } = mount();
    let armed = false;
    act(() => { armed = api().arm(() => ({ start: 4, end: 9 })); });
    expect(armed).toBe(true);
    expect(api().range).toEqual({ start: 4, end: 9 });
    unmount();
  });

  test('a range that MOVES afterwards does not change the captured one', () => {
    const { api, unmount } = mount();
    let selection = { start: 4, end: 9 };
    act(() => { api().arm(() => selection); });
    // The user drags a new selection; the armed range must not follow it.
    selection = { start: 20, end: 30 };
    expect(api().range).toEqual({ start: 4, end: 9 });
    unmount();
  });

  test('arming with nothing selected answers false and leaves no range', () => {
    const { api, unmount } = mount();
    let armed = true;
    act(() => { armed = api().arm(() => ({ start: 5, end: 5 })); });
    expect(armed).toBe(false);
    expect(api().range).toBeNull();
    act(() => { armed = api().arm(() => null); });
    expect(armed).toBe(false);
    expect(api().range).toBeNull();
    unmount();
  });

  test('disarming drops the range, so a later arm takes the THEN-current selection', () => {
    const { api, unmount } = mount();
    act(() => { api().arm(() => ({ start: 1, end: 3 })); });
    act(() => api().disarm());
    expect(api().range).toBeNull();
    act(() => { api().arm(() => ({ start: 7, end: 9 })); });
    expect(api().range).toEqual({ start: 7, end: 9 });
    unmount();
  });
});
