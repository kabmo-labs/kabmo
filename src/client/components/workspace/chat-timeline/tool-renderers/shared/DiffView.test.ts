/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A diff card's own chrome: the height ceiling and the counts.
 *
 * The bug the ceiling pins: the wrapper carried only `max-h-72 overflow-hidden`
 * and the view inside resolved `h-full` against its parent. `height: 100%`
 * against a box whose height is `auto` resolves to `auto`, so the view grew to
 * its full content — measured 1521px inside a 288px parent — and `overflow-hidden`
 * clipped the rest. `scrollHeight === clientHeight`, so nothing could scroll.
 * `min-h-0` on the flex column is what gives the child a definite height.
 *
 * The ROWS are not asserted here any more. The card renders through
 * CodeMirror's merge view, which draws only its viewport — and happy-dom
 * computes no layout, so a viewport is empty. Row rendering is covered where it
 * can be observed: `git-panel.e2e.ts` against the real panel, and
 * `patch-sides.test.ts` for the pair the card hands over.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { DiffView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/DiffView';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
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

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

/** omp's excerpt diff, long enough to overflow any ceiling. */
const EXCERPT = Array.from({ length: 120 }, (_, i) => `${i + 1}|line ${i + 1}`).join('\n');

async function mount(text = EXCERPT) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(DiffView, { text, path: 'src/x.ts' }), container);
  });
  return container;
}

describe('DiffView height ceiling', () => {
  test('the bounding wrapper does not scroll itself', async () => {
    const el = await mount();
    const wrap = el.querySelector('div[class*="max-h-72"]') as HTMLElement;
    expect(wrap).not.toBeNull();
    // `overflow-hidden`: the view inside is the scroller. Two scrollers stacked
    // means one of them eats the wheel event.
    expect(wrap.className).toContain('overflow-hidden');
    expect(wrap.className).not.toContain('overflow-auto');
  });

  test('the wrapper is the ceiling and the host is the marker the fill rule keys on', async () => {
    const el = await mount();
    const wrap = el.querySelector('div[class*="max-h-72"]') as HTMLElement;
    expect(wrap.className).toContain('flex');
    expect(wrap.className).toContain('flex-col');
    // Without `min-h-0` a flex item refuses to shrink below its content, so the
    // view can never be shorter than the file.
    expect(wrap.className).toContain('min-h-0');

    // `min-h-0` alone is NOT enough, and this test used to claim it was. It
    // lets the item shrink; what the editor root needs is a height to shrink
    // TO. `.cm-editor` is `height: 100%`, a percentage resolves against a
    // DEFINITE containing block, and a `max-height` ancestor is indefinite for
    // that — measured in the timeline, a 1847px root inside a 288px wrapper,
    // clipped by `overflow-hidden` with `scrollHeight === clientHeight`, so a
    // 30-line edit card showed 9 rows and could not scroll. The height now
    // arrives through LAYOUT (`[data-code-surface]` is a column flex container
    // and the root a shrinking item — `css.test.ts` gates the rule), which is
    // why the host must carry the marker: without it the rule matches nothing
    // and the clipping comes back with no error anywhere.
    const host = wrap.querySelector('[data-code-surface]') as HTMLElement | null;
    expect(host).not.toBeNull();
  });

  test('the header counts come from the patch, not from git', async () => {
    // ` 1|a / -2|b / +2|c` is an excerpt diff: one deletion, one addition.
    const el = await mount(' 1|a\n-2|b\n+2|c');
    const text = el.textContent ?? '';
    expect(text).toContain('+1');
    expect(text).toContain('\u22121');
  });

  test('a header-only patch falls back to the raw text', async () => {
    const el = await mount('--- a/x\n+++ b/x\n');
    // Nothing to compare means nothing to draw: the reader still sees the bytes
    // the tool returned rather than an empty box.
    expect(el.textContent).toContain('--- a/x');
    expect(el.querySelector('.cm-editor')).toBeNull();
  });
});
