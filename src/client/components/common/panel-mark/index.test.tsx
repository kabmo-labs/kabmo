/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A PANEL's mark — one colour per panel, on every surface.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 *
 * Three facts are load-bearing here, and each was a real defect:
 *
 * - **A built-in view takes its PANEL id's hue**, and it says so with `builtin`,
 *   not by inference from whether it has an icon. The rail used to hash the panel
 *   id while Settings drew the bare glyph and took the GLYPH's hue, so `Files`
 *   was `hsl(0 …)` in one place and `hsl(320 …)` in the other.
 * - **A plugin keeps its OWN mark colour**, which is keyed by its name — the same
 *   key its marketplace card uses.
 * - **Both stamp the LIGHT TONE** for that hue. Light's paint is a solved hex
 *   (`icon-tone.ts`), so a runtime hue with no tone falls back to the dated pair
 *   the tone replaced — visible as one dull mark in an otherwise bright rail.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { PanelMark } from '@/client/components/common/panel-mark';
import { ICON_TONES } from '@/shared/lib/icons/tint-hues.generated';
import { hashHue } from '@/shared/lib/icons/tint';
import { resolvePanelHues } from '@/shared/lib/workspace/panel-hues';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

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

function paint(node: ComponentChild): HTMLElement {
  act(() => {
    render(node, container);
  });
  const mark = container.querySelector<HTMLElement>('[data-panel-mark]');
  if (!mark) throw new Error('no panel mark rendered');
  return mark;
}

describe('PanelMark', () => {
  test('a built-in view takes the hue of its PANEL id, resolved over the whole set', () => {
    // Not the glyph's hue: `Files` draws `lucide-files` (320°), but the panel's
    // own id hashes to 0°. One panel, one colour, on every surface.
    const mark = paint(h(PanelMark, { panelId: 'files', builtin: true, name: 'Files', size: 20 }));
    const hue = Number(mark.style.getPropertyValue('--panel-hue'));

    expect(hue).toBe(resolvePanelHues().get('files')!);
    expect(mark.style.getPropertyValue('--panel-tone')).toBe(ICON_TONES.deepest[hue]!);
  });

  test('a plugin mark is keyed by its NAME, the same key its card uses', () => {
    // Keying a plugin panel by its slot id gave one plugin two colours: the rail
    // drew the slot's hash, its marketplace card drew the name's.
    const mark = paint(h(PanelMark, { panelId: 'plugin:git-forge', builtin: false, name: 'git-forge', size: 20 }));
    const hue = hashHue('git-forge');

    expect(Number(mark.style.getPropertyValue('--panel-hue'))).toBe(hue);
    expect(mark.style.getPropertyValue('--panel-tone')).toBe(ICON_TONES.deepest[hue]!);
  });

  test('a declared brand colour rides alongside the tone, as a clamped pair', () => {
    // The plugin author's colour is theirs: it is surfaced as a pair the
    // stylesheet reads BEFORE the hue, and `data-declared` exempts it from the
    // rail's idle filter so one brand is not two shades in two places.
    const mark = paint(
      h(PanelMark, { panelId: 'plugin:stats', builtin: false, name: 'stats', color: '#f59e0b', size: 20 }),
    );

    expect(mark.getAttribute('data-declared')).toBe('');
    expect(mark.style.getPropertyValue('--panel-color-light')).toMatch(/^#[0-9a-f]{6}$/);
    expect(mark.style.getPropertyValue('--panel-color-dark')).toMatch(/^#[0-9a-f]{6}$/);
    // The tone is still stamped: a declared colour that cannot be parsed must not
    // leave the mark on the dated fallback.
    expect(mark.style.getPropertyValue('--panel-tone')).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('no declared colour leaves both colour variables unset', () => {
    const mark = paint(h(PanelMark, { panelId: 'files', builtin: true, name: 'Files', size: 20 }));

    expect(mark.getAttribute('data-declared')).toBeNull();
    expect(mark.style.getPropertyValue('--panel-color-light')).toBe('');
    expect(mark.style.getPropertyValue('--panel-color-dark')).toBe('');
  });

  test('an idle mark says so through the attribute, not through its colour', () => {
    // The state is a luminance filter in the stylesheet; a caller's `text-ink/30`
    // would outrank the hue and paint the rail monochrome, which is what the
    // attribute replaced.
    expect(paint(h(PanelMark, { panelId: 'files', builtin: true, name: 'Files', size: 20, idle: true })).getAttribute('data-idle')).toBe('');
    expect(paint(h(PanelMark, { panelId: 'git', builtin: true, name: 'Git', size: 20 })).getAttribute('data-idle')).toBeNull();
  });
});
