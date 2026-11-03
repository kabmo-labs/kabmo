/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Annotating the user-browser panel.
 *
 * The failure this hook has to prevent is a mark outliving the page it was drawn
 * on. An iframe's internal navigation is invisible from this origin — the host
 * gets `onLoad` and nothing else — so a reload or a typed address is the only
 * signal that the document under the marks changed. Sending that stale batch
 * would point the agent at percentages of a page the user has left.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { useAnnotate, type UseAnnotateResult } from '@/client/hooks/browser/use-annotate';
import type { AnnotateShape } from '@/shared/types';

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

function mark(id: string, note = ''): AnnotateShape {
  return { id, tool: 'box', start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, note };
}

let container: HTMLElement | undefined;
let latest: UseAnnotateResult | undefined;
/** Drives the hook's page key, the way the panel's `frameKey` does. */
let navigate: (key: number) => void;

const api = (): UseAnnotateResult => {
  if (!latest) throw new Error('hook not rendered');
  return latest;
};

/** Mount the hook with a page key the test can change. */
function mount(): void {
  const Probe = () => {
    const [frameKey, setFrameKey] = useState(0);
    navigate = setFrameKey;
    latest = useAnnotate(frameKey);
    return h('div', null);
  };
  act(() => {
    render(h(Probe, null), container!);
  });
}

beforeEach(() => {
  container?.remove();
  container = document.body.appendChild(document.createElement('div'));
  latest = undefined;
});

describe('useAnnotate', () => {
  test('starts closed, with the box tool and no marks', () => {
    mount();
    expect(api().active).toBe(false);
    expect(api().tool).toBe('box');
    expect(api().shapes).toEqual([]);
  });

  test('toggle opens the mode and close shuts it, dropping the selection', () => {
    mount();
    act(() => api().toggle());
    expect(api().active).toBe(true);
    act(() => api().add(mark('a')));
    expect(api().selectedId).toBe('a');
    act(() => api().close());
    expect(api().active).toBe(false);
    expect(api().selectedId).toBeNull();
    // Closing the mode is not the same as discarding the marks.
    expect(api().shapes).toHaveLength(1);
  });

  test('a finished mark is committed and becomes the one being described', () => {
    mount();
    act(() => api().add(mark('a')));
    act(() => api().add(mark('b')));
    expect(api().shapes.map((shape) => shape.id)).toEqual(['a', 'b']);
    expect(api().selectedId).toBe('b');
  });

  test('a note is stored on its own mark only', () => {
    mount();
    act(() => api().add(mark('a')));
    act(() => api().add(mark('b')));
    act(() => api().setNote('a', 'tombol mati'));
    expect(api().shapes.map((shape) => shape.note)).toEqual(['tombol mati', '']);
  });

  test('removing the selected mark clears the selection; removing another leaves it', () => {
    mount();
    act(() => api().add(mark('a')));
    act(() => api().add(mark('b')));
    act(() => api().remove('a'));
    expect(api().selectedId).toBe('b');
    act(() => api().remove('b'));
    expect(api().selectedId).toBeNull();
    expect(api().shapes).toEqual([]);
  });

  test('reset clears the marks but leaves the mode as it was', () => {
    mount();
    act(() => api().toggle());
    act(() => api().add(mark('a')));
    act(() => api().reset());
    expect(api().shapes).toEqual([]);
    expect(api().active).toBe(true);
  });

  test('a new page drops every mark drawn on the old one', () => {
    mount();
    act(() => api().add(mark('a')));
    act(() => api().add(mark('b')));
    expect(api().shapes).toHaveLength(2);
    act(() => navigate(1));
    expect(api().shapes).toEqual([]);
    expect(api().selectedId).toBeNull();
  });
});
