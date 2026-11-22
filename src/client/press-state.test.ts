/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The press state: ONE scale, stated once, on the whole control family.
 *
 * Before this rule, 13 buttons carried their own `active:scale-*` at four
 * values (0.90 / 0.95 / 0.98, plus an `active:scale-98` Tailwind never emitted,
 * so that control had no press state at all) while ~880 buttons answered a
 * click with nothing at all. The value is a single fact, so a second copy in a
 * component is the defect these specs guard: it is how one button ends up
 * shrinking 5% beside a neighbour that shrinks 2%.
 *
 * A `<button>` is not the only control either. Counted across `src/client`
 * (excluding specs): 15 interactive elements are not buttons — 9
 * `div[role='button']`, 2 `div[role='tab']`, 1 `div[role='option']` and 3
 * `<summary>`. The first version of this rule listed only `button` and
 * `[role='button']`, so the panel strip's chip and the MCP disclosure answered a
 * press with nothing (measured on the production build: both computed
 * `scale: none` while held). The selector list is asserted below so a future
 * control type cannot quietly fall outside it again.
 *
 * The rule is UNLAYERED on purpose. Tailwind's `transition-*` utilities set
 * `transition-property` themselves, and a layered rule loses to them.
 */

import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readClientCss } from '@/test-support/glass-css';

const read = readClientCss;

/** The declaration block of the rule starting at `at` (multi-line selectors included). */
function bodyAt(css: string, at: number): string {
  const open = css.indexOf('{', at);
  const close = css.indexOf('\n}', open);
  return css.slice(open + 1, close);
}

/** The selector text of the rule that declares `scale: 0.97`, from its start. */
function pressSelector(css: string): string {
  const at = css.indexOf(':not(:disabled):active {', css.indexOf('The press state'));
  expect(at).toBeGreaterThan(-1);
  const start = css.lastIndexOf('/*', at);
  return css.slice(start, at + ':not(:disabled):active'.length);
}

describe('control press state', () => {
  test('one scale, applied to every control family', async () => {
    const css = await read('./tailwind.css');
    const selector = pressSelector(css);

    // Every family the app actually draws. Counted in `src/client` (specs
    // excluded): 9 role=button, 2 role=tab, 1 role=option, 3 summary, plus the
    // ordinary buttons, switches, menu rows and radios.
    for (const family of [
      'button',
      'summary',
      "[role='button']",
      "[role='tab']",
      "[role='option']",
      "[role='menuitem']",
      "[role='menuitemradio']",
      "[role='menuitemcheckbox']",
      "[role='radio']",
      "[role='checkbox']",
      "[role='switch']",
    ]) {
      expect({ family, listed: selector.includes(family) }).toEqual({ family, listed: true });
    }

    // Exactly one declaration of the value: a second rule for the same fact is
    // how the values drift apart again.
    expect([...css.matchAll(/\bscale:\s*0\.97;/g)]).toHaveLength(1);
  });

  test('a disabled control does not move', async () => {
    const css = await read('./tailwind.css');
    const selector = pressSelector(css);
    // `:not(:disabled)` guards the whole list, so a disabled button cannot
    // acknowledge a press. It never matches a non-form element, which is why
    // the same list serves both.
    expect(selector).toContain(':not(:disabled)');
    expect(selector).not.toMatch(/(^|[^:])button:active/);
  });

  test('the scale transitions, and composes with a call site transform', async () => {
    const css = await read('./tailwind.css');
    const at = css.indexOf(' * ------------------------------------------------------------------------- */\n:is(button, summary');
    expect(at).toBeGreaterThan(-1);
    const body = bodyAt(css, at);

    // `scale`, not `transform`: the individual property composes with whatever
    // transform a call site sets instead of replacing it.
    expect(body).toContain('scale');
    // Literals, not `var(--tw-duration)`: measured in WebKit, a layered custom
    // property never reaches a `<button>`, so the var form made the duration
    // engine-dependent (0.12s there, 0.2s in Chromium).
    expect(body).toContain('transition-duration: 120ms;');
    expect(body).toContain('transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);');
    expect(body).not.toContain('var(--tw-duration');
    // The colour properties Tailwind's `transition-*` utilities animate are
    // restated, because this unlayered rule replaces their property list.
    for (const property of ['background-color', 'border-color', 'opacity', 'box-shadow']) {
      expect(body).toContain(property);
    }
  });

  test('reduced motion drops the easing, not the state', async () => {
    const css = await read('./tailwind.css');
    const at = css.indexOf('/* Same list MINUS `scale`');
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('\n}\n', at));
    expect(block).toContain('transition-property:');
    // `scale` stays OUT of the reduced list, so the press still lands.
    expect(block).not.toContain('scale,');
  });

  test('a control containing the pressed control does not shrink with it', async () => {
    const css = await read('./tailwind.css');
    const at = css.indexOf(":is([role='button'], [role='option'], [role='menuitem']):has(");
    expect(at).toBeGreaterThan(-1);

    // Measured on the production build before this rule: a press on the model
    // picker's favourite star scaled the ROW and the star, 0.97 x 0.97.
    expect(bodyAt(css, at)).toContain('scale: none;');
  });

  test('a tab chip is the control that moves, not the button inside it', async () => {
    const css = await read('./tailwind.css');

    // The chip carries the fill, border and radius; its inner button is a bare
    // hit area. Suppressing the chip made only the label twitch.
    const inner = css.indexOf("[role='tab'] :is(button, [role='button']):not(:disabled):active");
    expect(inner).toBeGreaterThan(-1);
    expect(bodyAt(css, inner)).toContain('scale: none;');

    // And the chip itself is NOT the guard's SUBJECT, or it would never move.
    // (`[role='tab']` legitimately appears in the `:has()` argument: that is
    // what detects a pressed inner tab.)
    const guard = css.indexOf(":is([role='button'], [role='option'], [role='menuitem']):has(");
    expect(guard).toBeGreaterThan(-1);
    const subject = css.slice(guard, css.indexOf(':has(', guard));
    expect(subject).not.toContain("[role='tab']");
  });

  test('a link styled as a control answers like one', async () => {
    const css = await read('./tailwind.css');
    const selector = pressSelector(css);

    // 20 anchors ship; 10 are controls (wiki nav rows, external-link plates, the
    // web-search chip, the About dialog's social rows, the update popup, the QR
    // download). All were inert on press before this.
    expect(selector).toContain('a[href]');

    // Matched by exact class TOKEN, not substring: `flex-shrink-0` matches
    // `[class*='flex']` but leaves an inline box, where `scale` is a no-op
    // (measured: an inline anchor at `scale: 0.97` keeps its 42.48px width).
    expect(selector).toContain("[class~='flex']");
    expect(selector).not.toContain("[class*='flex']");
    // The display list has to include every box type that can be transformed.
    for (const token of ["[class~='inline-flex']", "[class~='block']", "[class~='inline-block']", "[class~='grid']"]) {
      expect(selector).toContain(token);
    }
  });

  test('no call site re-declares the press scale', async () => {
    const offenders: string[] = [];
    for await (const file of new Glob('src/client/**/*.tsx').scan('.')) {
      const source = await Bun.file(file).text();
      for (const match of source.matchAll(/active:scale-[^\s'"`}]+/g)) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
