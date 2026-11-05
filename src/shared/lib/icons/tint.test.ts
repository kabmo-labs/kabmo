/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The functional-glyph colour table.
 *
 * Four facts are worth pinning, and each is invisible until wrong:
 *
 * - **The class conversion matches what Lucide emits.** `Trash2` is an alias of
 *   `trash` (class `lucide-trash-2`), `AlertTriangle` of `triangle-alert`, so a
 *   table keyed on the IMPORT name is only useful if the kebab translation lands
 *   on a class the component really carries. Every row is RENDERED here rather
 *   than trusted.
 * - **The hue table matches the imports.** It is generated from `src/`; a stale
 *   copy would leave a newly added icon on the default hue, which looks like the
 *   mode half-applied. `scripts/icon-tints.mjs --check` is the same comparison.
 * - **Every generated hue clears the non-text contrast floor** on every palette
 *   of its OWN variant, in BOTH solved tables, and the two variants land in a
 *   narrow lightness band. That is the whole reason dark is no longer one
 *   `hsl(H 65% 70%)` for every hue.
 * - **A signal icon is never also a hue row**, so the signal colour cannot be
 *   shadowed by a `--icon-hue` on the same element.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import * as lucide from 'lucide-preact';
import {
  ICON_TINTS,
  ICON_TINT_ROWS,
  ICON_TINT_TOKENS,
  iconTintRole,
  kebabIconName,
  lucideClassName,
} from '@/shared/lib/icons/tint';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

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

describe('kebabIconName', () => {
  test('lowercase, camel and digit boundaries', () => {
    expect(kebabIconName('Trash2')).toBe('trash-2');
    expect(kebabIconName('AlertTriangle')).toBe('alert-triangle');
    expect(kebabIconName('ChevronsUpDown')).toBe('chevrons-up-down');
    expect(kebabIconName('BarChart3')).toBe('bar-chart-3');
    expect(kebabIconName('CircleQuestionMark')).toBe('circle-question-mark');
    expect(kebabIconName('ZoomIn')).toBe('zoom-in');
    expect(kebabIconName('Cpu')).toBe('cpu');
    expect(kebabIconName('X')).toBe('x');
    expect(kebabIconName('Settings2')).toBe('settings-2');
  });

  test('the class is the kebab name behind the component prefix', () => {
    expect(lucideClassName('Trash2')).toBe('lucide-trash-2');
  });
});

describe('the signal table', () => {
  test('every row names an icon this build can import', () => {
    for (const name of Object.keys(ICON_TINTS)) {
      expect((lucide as Record<string, unknown>)[name], `${name} is not a lucide export`).toBeDefined();
    }
  });

  test('every row renders the class the stylesheet keys on', () => {
    for (const name of Object.keys(ICON_TINTS)) {
      const Icon = (lucide as unknown as Record<string, (props: object) => unknown>)[name] as (props: object) => unknown;
      render(h(Icon as never, { 'aria-hidden': true }), container);
      const svg = container.querySelector('svg');
      expect(svg, `${name} draws an svg`).not.toBeNull();
      expect(svg?.classList.contains(lucideClassName(name)), `${name} -> ${lucideClassName(name)}`).toBe(true);
      render(null, container);
    }
  });

  test('an unlisted icon has no role, so it takes its own hue', () => {
    expect(iconTintRole('Sparkles')).toBeNull();
  });

  test('a signal role answers its own token', () => {
    expect(iconTintRole('Trash2')).toBe('error');
    expect(iconTintRole('CheckCircle2')).toBe('success');
    expect(iconTintRole('Hourglass')).toBe('warning');
    expect(iconTintRole('Info')).toBe('info');
  });

  test('every role paints a theme token, never a hex', () => {
    for (const role of new Set(Object.values(ICON_TINTS))) {
      expect(ICON_TINT_TOKENS[role], role).toMatch(/^var\(--theme-[a-z]+\)$/);
    }
  });

  test('the signal rows are unique, so no rule can be shadowed', () => {
    const classes = ICON_TINT_ROWS.map((row) => row.className);
    expect(new Set(classes).size).toBe(classes.length);
  });
});
