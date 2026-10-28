/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ink the provider marks are painted in.
 *
 * Almost every source art (`anthropic`, `openai`, `deepseek`, `google`, …) is
 * drawn with NO paint attribute at all and relies on the SVG default — which is
 * BLACK, not the surrounding ink. The table therefore cannot carry the fix (its
 * entries are inner markup only), and the `<svg>` this component owns has to
 * declare `fill="currentColor"`; `fill` is an inherited property, so that one
 * attribute reaches every descendant that does not set its own paint.
 *
 * Without it the marks are black on every theme, which is invisible only on a
 * dark canvas and so went unnoticed for the app's whole life: measured on the
 * rendered Kabmo, a mark over `aura-dark`'s panel (#201E2B) composited to
 * `rgb(0,0,0)` — contrast 1.28:1 — while the same mark under this component
 * paints in the palette's ink (contrast 5.88:1).
 *
 * Rendered with `h()` (no JSX) against happy-dom, following `PluginMark`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { ProviderIcon } from '@/client/components/common/provider-icon';
import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip
 *  natives (Event/CustomEvent) every later file needs. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

// Installed per CASE, not per file: another suite's teardown can strip `window`
// mid-file when the runner interleaves files.
beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = win[key as keyof Window];
    target[key] = win[key as keyof Window];
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

function paint(node: ComponentChild): HTMLElement {
  act(() => {
    render(node, container);
  });
  return container;
}

describe('ProviderIcon ink', () => {
  test('a mark is painted in the surrounding ink, never the SVG default black', () => {
    const svg = paint(h(ProviderIcon, { slug: 'deepseek', name: 'DeepSeek' })).querySelector('svg');

    expect(svg).not.toBeNull();
    // The glyph body carries no paint of its own (`glyphs.test.ts` pins that),
    // so this attribute is the only thing keeping the mark off black.
    expect(svg?.getAttribute('fill')).toBe('currentColor');
  });

  test('every glyph in the table resolves to that ink', () => {
    for (const [name, glyph] of Object.entries(PROVIDER_GLYPHS)) {
      const el = paint(h(ProviderIcon, { slug: name }));
      const svg = el.querySelector('svg');
      expect(svg, `${name} must draw an svg`).not.toBeNull();
      expect(svg?.getAttribute('fill'), `${name} ink`).toBe('currentColor');
      expect(svg?.getAttribute('viewBox'), `${name} box`).toBe(glyph.viewBox);
    }
  });

  test('the size and the caller class ride on the svg, not the inner markup', () => {
    const svg = paint(h(ProviderIcon, { slug: 'openai', size: 20, className: 'shrink-0' })).querySelector('svg');

    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
    expect(svg?.getAttribute('class')).toContain('shrink-0');
  });

  test('a provider with no mark keeps its initials instead of an empty box', () => {
    const el = paint(h(ProviderIcon, { slug: 'definitely-not-a-provider', name: 'Toktok ID' }));

    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toBe('ti.');
  });
});
