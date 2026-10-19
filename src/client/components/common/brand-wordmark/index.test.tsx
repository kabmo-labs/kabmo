/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The wordmark's three colour runs.
 *
 * The split is a brand decision, not a style detail: the `K` carries the icon's
 * own accent, `ab` keeps the gradient the previous wordmark used for its leading
 * run, and `mo` is surface ink. A later "simplify" that flattened all three into
 * one colour would still render the right word — which is exactly why it needs a
 * test rather than a screenshot.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { BrandWordmark } from '@/client/components/common/brand-wordmark';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives later files need. */
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

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

function mount(className?: string): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  render(h(BrandWordmark, className ? { className } : {}), container);
  return container;
}

function runsOf(root: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const span of root.querySelectorAll('span')) {
    const text = span.textContent ?? '';
    // Only the leaf runs; the root also contains the whole word.
    if (span.children.length === 0 && text.length > 0) out.set(text, span);
  }
  return out;
}

describe('BrandWordmark', () => {
  test('splits the word into K, ab and mo', () => {
    const runs = runsOf(mount());
    expect([...runs.keys()]).toEqual(['K', 'ab', 'mo']);
  });

  test('each run carries its own colour class', () => {
    const runs = runsOf(mount());
    // The K takes the icon's accent token, never a themed colour: the logo does
    // not change hue with the palette, and the K is the letter that carries it.
    expect(runs.get('K')?.className).toContain('text-brand');
    // `ab` keeps the previous wordmark's gradient, as a gradient (not a fill).
    expect(runs.get('ab')?.className).toContain('bg-clip-text');
    expect(runs.get('ab')?.className).toContain('bg-gradient-to-r');
    expect(runs.get('ab')?.className).toContain('from-orange-600');
    expect(runs.get('ab')?.className).toContain('to-amber-500');
    // `mo` stays surface ink, which is what keeps it legible on dark palettes.
    expect(runs.get('mo')?.className).toContain('text-ink');
  });

  test('a caller sets the size and cannot drop the wordmark classes', () => {
    const root = mount('text-2xl').firstElementChild as HTMLElement;
    expect(root.className).toContain('text-2xl');
    expect(root.className).toContain('tracking-tighter');
    expect(root.className).toContain('font-extrabold');
  });
});
