/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a call site outranks the icon colour mode.
 *
 * Two rules, and both are a measured defect rather than a preference:
 *
 * - **An author's signal class.** Twenty-two glyphs carried `text-error`,
 *   `text-success`, `text-warning` or `text-info` to say what they MEANT, and
 *   the mode repainted every one with its hashed hue — it discarded the only
 *   colour information the call site had.
 * - **A solid signal fill.** `bg-error text-canvas` is a filled destructive
 *   button, and the glyph was painted in the same red as its own fill: 1.00:1.
 */

import { describe, expect, test } from 'bun:test';
import { iconPaintStyleSheet } from '@/shared/lib/icons/icon-paint-css';

const css = iconPaintStyleSheet();

describe('an author class is authority', () => {
  test('every signal class a glyph can carry resolves to its palette token', () => {
    // The mode paints by hue, and a hue is only the answer to "this icon said
    // nothing". Twenty-two call sites say something — a `LogOut` on a destructive
    // provider action, a `Play` on a successful eval, an `Info` on a reconnect —
    // and every one of them was repainted with its hashed hue the moment the
    // setting was turned on.
    for (const [token, value] of [
      ['text-error', 'var(--theme-error)'],
      ['text-success', 'var(--theme-success)'],
      ['text-warning', 'var(--theme-warning)'],
      ['text-info', 'var(--theme-info)'],
      ['text-meta', 'var(--theme-meta)'],
    ] as const) {
      expect(css).toContain(`:where([data-icon-style="color"]) :where(svg[class~="${token}"]) { --icon-color: ${value}; }`);
    }
  });

  test('the slashed form is the same statement at a weight', () => {
    // `text-error/60` is six live call sites; without a rule for the slashed
    // token the icon falls back to the hue while the class says otherwise.
    expect(css).toContain(
      ':where([data-icon-style="color"]) :where(svg[class~="text-error/60"]) { --icon-color: oklch(from var(--theme-error) l calc(c * 0.6) h); }',
    );
    // A weight scales chroma and leaves lightness — the same rule the ink
    // weights obey, so a muted signal does not go dark.
    const slashed = css.split('\n').filter((line) => /class~="text-(error|success|warning|info|meta)\/\d+"/.test(line));
    expect(slashed.length).toBeGreaterThan(0);
    for (const line of slashed) expect(line, line.slice(0, 80)).toContain('oklch(from');
  });

  test('a token matches one class WORD, never a substring', () => {
    // `[class*=…]` would also fire on `group-hover:text-error`, painting the
    // resting glyph red — the defect the ink weights were fixed for.
    const authorRules = css.split('\n').filter((line) => line.includes('svg[class~="text-'));
    expect(authorRules.length).toBeGreaterThan(0);
    for (const line of authorRules) expect(line, line.slice(0, 80)).toContain('[class~="');
    expect(css).not.toContain('svg[class*="text-');
  });
});

describe('a solid signal fill owns its foreground', () => {
  const scope =
    '[class~="bg-error"], [class~="bg-error-text"], [class~="bg-success"], [class~="bg-success-text"], [class~="bg-warning"], [class~="bg-warning-text"], [class~="bg-info"], [class~="bg-info-text"]';

  test('an icon on bg-error/success/warning/info takes the inherited colour', () => {
    // `bg-error text-canvas` is a filled destructive button — Delete, Close, the
    // mobile save — and the glyph was painted in the SAME red as its fill:
    // measured in the running console, `Trash2` computed rgb(200,50,30) on
    // rgb(200,50,30), 1.00:1, a blank square where a bin should be.
    //
    // `-text` is the same slot solved to 4.5:1 against paper and canvas, and it
    // is the token a filled CONTROL uses: the raw palette hex is chosen for a
    // chip's ground (measured 1.94:1 on `aura-light` for info). A scope that
    // knew only the raw spelling left the composer's Stop and Send glyphs on
    // the icon mode's own hue.
    expect(css).toContain(`[data-icon-style="color"] :where(${scope}) svg.lucide { color: currentColor; }`);
  });

  test('the same fill in monochrome, which is the DEFAULT mode', () => {
    expect(css).toContain(`:root:not([data-icon-style="color"]) :where(${scope}) svg.lucide { color: currentColor; }`);
  });

  test('a TINTED signal chip keeps its hue', () => {
    // `bg-error/10` is a different class token, so the rule above cannot catch a
    // chip that merely borrows the signal as a wash.
    expect(css).not.toContain('[class*="bg-error');
    expect(css).not.toContain('bg-error/');
  });

  test('a plugin mark on the fill takes it too', () => {
    expect(css).toContain(`:where([data-icon-style="color"]) :where(${scope}) :where([data-plugin-mark]) { --plugin-color: currentColor; }`);
    expect(css).toContain(`:root:not([data-icon-style="color"]) :where(${scope}) :where([data-plugin-mark]) { --plugin-color: currentColor; }`);
  });
});
