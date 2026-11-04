/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugin mark, and the fallback that makes an absent icon a CHOICE.
 *
 * `icon` is optional in the manifest, so a plugin may ship none — and the whole
 * reason this component exists is that the fallback must read as "this plugin
 * has no icon" rather than "something failed to load". The initials rule is
 * shared with the provider marks on purpose: a plugin badge and a provider badge
 * sitting in the same list must not look like two different systems.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { ICON_TONES } from '@/shared/lib/icons/tint-hues.generated';

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
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
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

function paint(node: ComponentChild) {
  act(() => {
    render(node, container);
  });
  return container;
}

describe('PluginMark', () => {
  test('paints a vector mark through a currentColor mask, not an <img>', () => {
    // An SVG loaded through `<img>` is a separate document and cannot resolve
    // `currentColor`, so a plugin's mark kept one ink while every built-in view
    // moved with the theme. A mask has no document to inherit into: the host
    // supplies the paint and the file supplies only its alpha channel.
    const el = paint(h(PluginMark, { name: 'Demo', iconUrl: '/api/panels/icon/demo/icon.svg?v=abc', size: 16 }));
    const span = el.querySelector('span');

    expect(el.querySelector('img')).toBeNull();
    expect(span?.style.width).toBe('16px');
    expect(span?.style.height).toBe('16px');
    // The paint is a VARIABLE, so the mode decides it: monochrome leaves
    // `--plugin-color` undefined and the mark keeps the ink it always used.
    expect(span?.style.backgroundColor).toBe('var(--plugin-color, currentColor)');
    expect(span?.getAttribute('data-plugin-mark')).toBe('');
    expect(span?.style.getPropertyValue('--icon-hue')).not.toBe('');
    // The extension is read off the PATH; the registry's URL carries a `?v=` hash.
    expect(span?.style.maskImage).toContain('/api/panels/icon/demo/icon.svg?v=abc');
    expect(span?.style.maskSize).toBe('contain');
    // The component ALSO sets the `-webkit-` spellings, which Safari needs.
    // happy-dom drops a prefixed property outright (`'webkitMaskImage' in style`
    // is false, and `setProperty('-webkit-mask-image', …)` stores nothing), so
    // that half is pinned against real Chrome in the browser instead of here.
    // Decorative: the plugin's name is always rendered beside it.
    expect(span?.getAttribute('aria-hidden')).toBe('true');
  });

  test('keeps an <img> for a raster mark, whose own colours and alpha matter', () => {
    // Masking a PNG would throw its colour away, and a JPEG has no alpha to
    // mask with — it would paint the box solid.
    const el = paint(h(PluginMark, { name: 'Demo', iconUrl: '/api/panels/icon/demo/logo.png?v=abc', size: 16 }));
    const img = el.querySelector('img');

    expect(el.querySelector('span')).toBeNull();
    expect(img?.getAttribute('src')).toBe('/api/panels/icon/demo/logo.png?v=abc');
    expect(img?.style.width).toBe('16px');
    expect(img?.style.height).toBe('16px');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });

  test('an extensionless mark URL takes the <img> path', () => {
    // A mask of an unknown format either paints nothing or paints the box
    // solid, so anything not named `.svg` stays a raster.
    const el = paint(h(PluginMark, { name: 'Demo', iconUrl: '/api/panels/icon/demo/mark', size: 16 }));

    expect(el.querySelector('img')).not.toBeNull();
    expect(el.querySelector('span')).toBeNull();
  });

  test('a plugin mark carries its own hue, stable across renders', () => {
    const first = paint(h(PluginMark, { name: 'Demo Plugin', iconUrl: '/api/panels/icon/demo/icon.svg' }))
      .querySelector('span');
    const hue = first?.style.getPropertyValue('--icon-hue');
    render(null, container);
    const second = paint(h(PluginMark, { name: 'Demo Plugin', iconUrl: '/api/panels/icon/demo/icon.svg' }))
      .querySelector('span');

    expect(hue).toMatch(/^\d+$/);
    expect(second?.style.getPropertyValue('--icon-hue')).toBe(hue);
    expect(paint(h(PluginMark, { name: 'Another Plugin' })).querySelector('span')?.style.getPropertyValue('--icon-hue')).not.toBe(hue);
  });

  test('a plugin mark stamps the LIGHT tone for its hue, not just the hue', () => {
    // The hue alone is enough for dark (one `hsl()` pair) but not for light: the
    // light paint is a solved per-hue hex, and a plugin's hue exists only at
    // runtime, so no generated CSS row can carry it. Without this stamp a plugin
    // would fall back to the dated `hsl(H 60% 30%)` while every glyph beside it
    // got the brighter tone — the reported muddiness, on one icon only.
    const badge = paint(h(PluginMark, { name: 'Demo Plugin' })).querySelector('span');
    const hue = Number(badge?.style.getPropertyValue('--icon-hue'));
    const tone = badge?.style.getPropertyValue('--icon-tone') ?? '';

    expect(tone).toMatch(/^#[0-9a-f]{6}$/);
    expect(tone).toBe(ICON_TONES[hue]);
  });

  test('the initials fallback takes the same colour hook as a vector mark', () => {
    const badge = paint(h(PluginMark, { name: 'Session Info' })).querySelector('span');

    expect(badge?.getAttribute('data-plugin-mark')).toBe('');
    // 45% of the palette ink is what `text-ink/45` meant, restated as a value so
    // the colour mode can replace it without a second class.
    expect(badge?.style.color).toBe('var(--plugin-color, color-mix(in srgb, var(--theme-ink) 45%, transparent))');
  });

  test('a declared colour rides as a clamped pair, so the mode still gates it', () => {
    // The manifest's `color` is the plugin's own brand. It is set as custom
    // properties rather than as a colour, because `monochrome` must still paint
    // the palette ink — the stylesheet reads them only under
    // `[data-icon-style="color"]`. Two values, because `#34d399` is 1.9:1 on
    // white paper and 7:1 on dark: `legiblePair` derives the light one.
    const el = paint(h(PluginMark, { name: 'Demo', iconUrl: '/api/panels/icon/demo/icon.svg', color: '#34d399' }));
    const span = el.querySelector('span');
    const light = span?.style.getPropertyValue('--plugin-declared-light') ?? '';

    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(light).not.toBe('#34d399');
    expect(span?.style.getPropertyValue('--plugin-declared-dark')).toBe('#34d399');
    expect(span?.style.backgroundColor).toBe('var(--plugin-color, currentColor)');
  });

  test('no declared colour leaves both variables unset, so the hue applies', () => {
    const span = paint(h(PluginMark, { name: 'Demo' })).querySelector('span');

    expect(span?.style.getPropertyValue('--plugin-declared-light')).toBe('');
    expect(span?.style.getPropertyValue('--plugin-declared-dark')).toBe('');
    expect(span?.style.getPropertyValue('--icon-hue')).not.toBe('');
  });

  test('falls back to the plugin initials when no icon is declared', () => {
    const el = paint(h(PluginMark, { name: 'Session Info', size: 16 }));

    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('si.');
  });

  test('follows the shared initials rule for slugs and single words', () => {
    expect(paint(h(PluginMark, { name: 'toktok-id' })).textContent).toBe('ti.');
    expect(paint(h(PluginMark, { name: 'Tooker' })).textContent).toBe('t.');
  });

  test('renders a visible badge for a plugin with no usable name', () => {
    // A blank box would read as a broken plugin rather than an unnamed one.
    expect(paint(h(PluginMark, { name: '' })).textContent).toBe('?');
  });

  test('the tile variant adds a background and keeps the initials', () => {
    const el = paint(h(PluginMark, { name: 'Quick Notes', size: 36, tile: true }));
    const badge = el.querySelector('span');

    expect(badge?.className).toContain('bg-ink/5');
    expect(badge?.className).toContain('rounded');
    expect(el.textContent).toBe('qn.');
  });

  test('the plain variant draws no background, for a toolbar button', () => {
    const badge = paint(h(PluginMark, { name: 'Demo' })).querySelector('span');
    expect(badge?.className).not.toContain('bg-ink/5');
  });
});
