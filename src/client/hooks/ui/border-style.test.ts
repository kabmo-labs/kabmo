/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `data-borders` on `<html>`, and the CSS set it points at.
 *
 * Two facts a wrong implementation breaks silently, and neither is visible in a
 * component test:
 *
 * 1. **`hairline` CLEARS the attribute.** It is the state CSS paints with no
 *    attribute, so writing `data-borders="hairline"` would make a reloaded
 *    document disagree with the one the server served.
 * 2. **The CSS removes COLOUR, never width.** `box-sizing: border-box` is
 *    global, so a width of 0 would shorten every box by 2px and shift the whole
 *    layout — the defect this assertion exists to catch, because it would look
 *    like "the setting moved the panels" rather than "the setting is wrong".
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { applyBorderStyle, initBorderStyle } from '@/client/hooks/ui/border-style';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import { BORDER_STYLE_SETTING_KEY } from '@/shared/lib/theme/border-style';
import { readClientCss, ruleBody } from '@/test-support/glass-css';

const DOM_GLOBALS = ['window', 'document'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = win[key as keyof Window];
    target[key] = win[key as keyof Window];
  }
  document.documentElement.removeAttribute('data-borders');
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

describe('applyBorderStyle', () => {
  test('borderless is written as the attribute the CSS keys on', () => {
    applyBorderStyle('borderless');

    expect(document.documentElement.getAttribute('data-borders')).toBe('borderless');
  });

  test('hairline CLEARS the attribute instead of writing it', () => {
    applyBorderStyle('borderless');
    applyBorderStyle('hairline');

    expect(document.documentElement.hasAttribute('data-borders')).toBe(false);
  });

  test('an unknown value resolves to hairline and therefore writes nothing', () => {
    applyBorderStyle('borderless');
    applyBorderStyle('naked');

    expect(document.documentElement.hasAttribute('data-borders')).toBe(false);
  });
});

describe('the boot path', () => {
  test('a stored borderless style is applied from the primed snapshot', () => {
    primeKabmoSettings({ kabmo_settings: { borderStyle: 'borderless' } });
    initBorderStyle();

    expect(document.documentElement.getAttribute('data-borders')).toBe('borderless');
  });

  test('an install with no stored preference boots the ruled look', () => {
    primeKabmoSettings({});
    initBorderStyle();

    expect(document.documentElement.hasAttribute('data-borders')).toBe(false);
  });

  test('the settings key names a real field, so the write survives a reload', () => {
    expect(Object.keys(DEFAULT_SETTINGS)).toContain(BORDER_STYLE_SETTING_KEY);
  });
});

describe('borders.css', () => {
  const rootSelector = ':root[data-borders="borderless"]';

  /** The stylesheet without its comments, so prose about a property is not read as the property. */
  const declarations = async (): Promise<string> => (await readClientCss('borders.css')).replace(/\/\*[\s\S]*?\*\//g, '');

  /** Every rule's selector, multi-line selector lists included. */
  const selectors = (css: string): string[] => {
    const found: string[] = [];
    let cursor = 0;
    while ((cursor = css.indexOf('{', cursor)) >= 0) {
      const start = css.lastIndexOf('}', cursor) + 1;
      found.push(css.slice(start, cursor).trim());
      cursor += 1;
    }
    return found;
  };

  test('the whole set is scoped to the document attribute, so hairline is untouched', async () => {
    const all = selectors(await declarations());
    expect(all.length).toBeGreaterThan(2);
    // A rule without the attribute would remove a border for EVERY install, not
    // just a borderless one — the failure a template-literal selector invites.
    for (const selector of all) {
      expect({ selector, scoped: selector.startsWith(rootSelector) }).toEqual({ selector, scoped: true });
    }
  });

  test('the hairline rungs are cleared by COLOUR, never by width', async () => {
    const css = await declarations();
    expect(css).toContain('border-color: transparent');
    // `border-width: 0` / `border: none` would change every box's geometry.
    expect(css).not.toMatch(/border-width\s*:\s*0/);
    expect(css).not.toMatch(/border\s*:\s*(none|0)\b/);
  });

  test('every structural rung is covered, and no interaction rung is', async () => {
    const css = await declarations();
    // `/5`–`/20` is the structural layer (a separator, a panel's edge, a card's
    // outline). `/25` and up is hover / focus / active, which must keep working.
    for (const rung of ['5', '6', '8', '10', '12', '15', '20']) {
      expect({ rung, covered: new RegExp(`\\.border-ink\\\\/${rung}(?![\\d])`).test(css) })
        .toEqual({ rung, covered: true });
    }
    for (const rung of ['25', '30', '40', '50', '60']) {
      expect({ rung, listed: new RegExp(`border-ink\\\\/${rung}(?![\\d])`).test(css) })
        .toEqual({ rung, listed: false });
    }
  });

  test('a form control keeps its own edge through the exemption list', async () => {
    const css = await declarations();
    const rule = css.slice(css.indexOf(':is('), css.indexOf('border-color: transparent'));
    // A field with no edge is a field you cannot find; a `button` is NOT exempt,
    // because most of them are cards and chips whose outline is decoration.
    for (const tag of ['input', 'textarea', 'select', 'kbd', '[role="switch"]', '[contenteditable="true"]']) {
      expect({ tag, exempt: rule.includes(tag) }).toEqual({ tag, exempt: true });
    }
    expect(rule).not.toContain('button');
    // A dashed box is an affordance, not a separator.
    expect(rule).toContain('.border-dashed');
  });

  test('a dialog keeps an edge via outline, never by replacing its shadow', async () => {
    const css = await declarations();
    const start = css.indexOf(':is(.glass-overlay, .glass-popover)');
    expect(start).toBeGreaterThan(-1);
    const rim = css.slice(start, css.indexOf('}', start));
    // Every carrier states its own elevation (`shadow-2xl`, `--glass-shadow`).
    // A `box-shadow` here would REPLACE it and flatten the dialog.
    expect(rim).toContain('outline:');
    expect(rim).not.toContain('box-shadow');
  });

  test('the published hairline tokens are cleared with the rules', async () => {
    const css = await declarations();
    const tokens = ruleBody(css, rootSelector);
    expect(tokens).toContain('--glass-hairline: transparent');
    expect(tokens).toContain('--ink-hairline: transparent');
  });
});
