/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A contents row inside a rendered preview.
 *
 * The four rules the hook encodes are each a way the click silently does
 * nothing, and happy-dom computes no layout — so the geometry is stubbed and the
 * ASSERTIONS are the ones a browser would show: which heading was chosen, where
 * `scrollTop` ended, whether the pending restore was cancelled, and whether the
 * request was cleared exactly once.
 *
 * The scroller is a real element holding real `<h1>…<h6>` nodes, because the
 * heading walk is the code under test: a stub that returned headings directly
 * would test the stub.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useHeadingJump } from '@/client/hooks/editor/use-heading-jump';
import { getHeadingReveal, setHeadingReveal } from '@/client/lib/heading-reveal';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let scroller: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  scroller.remove();
  setHeadingReveal(null);
});

afterAll(() => {
  restoreDomGlobals();
});

/**
 * A scroller whose headings sit at a known offset.
 *
 * `getBoundingClientRect` is stubbed because happy-dom computes no layout, and
 * the hook measures a RECT delta rather than `offsetTop` — a positioned ancestor
 * makes `offsetTop` drift, which is why the hook does not use it.
 */
function makeScroller(headings: Array<{ level: number; text: string; top: number }>): HTMLElement {
  const element = document.createElement('div');
  for (const { level, text, top } of headings) {
    const heading = document.createElement(`h${level}`);
    heading.textContent = text;
    heading.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    element.appendChild(heading);
  }
  element.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 400, width: 400, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  element.scrollTop = 0;
  document.body.appendChild(element);
  return element;
}

interface ProbeProps {
  path: string | null;
  preview: boolean;
}

function Probe({ path, preview }: ProbeProps) {
  useHeadingJump({ path, scroller, preview });
  return h('div', {});
}

async function mount(props: ProbeProps): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Probe, props), container);
  });
}

describe('useHeadingJump', () => {
  test('scrolls the preview to the heading the row named, and stays in the preview', async () => {
    scroller = makeScroller([
      { level: 1, text: 'Title', top: 0 },
      { level: 2, text: 'First Section', top: 400 },
      { level: 2, text: 'Second Section', top: 900 },
    ]);
    await mount({ path: 'notes.md', preview: true });

    await act(async () => {
      setHeadingReveal({ path: 'notes.md', text: 'second section', occurrence: 0, index: 2 });
    });

    // 900 - 0 - the 12px pad: the heading lands just inside the top edge.
    expect(scroller.scrollTop).toBe(888);
    // Served once, and no line request: the preview is where the reader stays.
    expect(getHeadingReveal()).toBeNull();
  });

  test('the second of two identically-named headings is reachable', async () => {
    scroller = makeScroller([
      { level: 2, text: 'Notes', top: 100 },
      { level: 2, text: 'Notes', top: 700 },
    ]);
    await mount({ path: 'notes.md', preview: true });

    await act(async () => {
      setHeadingReveal({ path: 'notes.md', text: 'notes', occurrence: 1, index: 1 });
    });

    expect(scroller.scrollTop).toBe(688);
  });

  test('a source spelling matches the RENDERED heading text', async () => {
    scroller = makeScroller([{ level: 2, text: 'Hello world', top: 300 }]);
    await mount({ path: 'notes.md', preview: true });

    // The row's name is what the SOURCE said; the heading prints the rendered
    // text. Comparing them raw matches nothing at all.
    await act(async () => {
      setHeadingReveal({ path: 'notes.md', text: 'hello **world**', occurrence: 0, index: 0 });
    });

    expect(scroller.scrollTop).toBe(288);
  });

  test('a request for another document stays pending', async () => {
    scroller = makeScroller([{ level: 1, text: 'Title', top: 500 }]);
    await mount({ path: 'notes.md', preview: true });

    await act(async () => {
      setHeadingReveal({ path: 'other.md', text: 'title', occurrence: 0, index: 0 });
    });

    expect(scroller.scrollTop).toBe(0);
    expect(getHeadingReveal()).not.toBeNull();
  });

  test('a SOURCE view neither serves nor drops a contents row', async () => {
    scroller = makeScroller([{ level: 1, text: 'Title', top: 500 }]);
    await mount({ path: 'notes.md', preview: false });

    await act(async () => {
      setHeadingReveal({ path: 'notes.md', text: 'title', occurrence: 0, index: 0 });
    });

    // A heading index means nothing to a code surface, so it is not applied —
    // and it is not discarded either, because dropping it would lose a click the
    // preview can still serve.
    expect(scroller.scrollTop).toBe(0);
    expect(getHeadingReveal()).not.toBeNull();
  });

  test('a heading that has not rendered yet stays pending', async () => {
    // The preview's content lands a frame after its scroller, so a request can
    // arrive before any heading exists. Dropping it there loses a click that was
    // about to be servable.
    scroller = makeScroller([]);
    await mount({ path: 'notes.md', preview: true });

    await act(async () => {
      setHeadingReveal({ path: 'notes.md', text: 'title', occurrence: 0, index: 0 });
    });

    expect(scroller.scrollTop).toBe(0);
    expect(getHeadingReveal()).not.toBeNull();
  });
});
