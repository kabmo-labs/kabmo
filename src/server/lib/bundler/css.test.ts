/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import cssPlugin from '@/server/lib/bundler/css';

/**
 * Build one stylesheet through the REAL plugin with the options the client
 * build uses (`target: 'bun'`, `minify: true`), and return the emitted CSS.
 *
 * This is the end-to-end gate for the nesting bug: Bun's minifier re-nests a
 * rule's nested at-rule as `@supports (…) { & { … } }` for a non-browser
 * target, and Chrome then drops it whenever the parent selector names a
 * pseudo-element. Asserting on the flattener's own output cannot catch that —
 * only the bundle the browser is actually served can.
 */
async function buildThroughPlugin(css: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ompchamber-css-'));
  try {
    await Bun.write(join(dir, 'probe.css'), css);
    const result = await Bun.build({
      entrypoints: [join(dir, 'probe.css')],
      outdir: join(dir, 'out'),
      target: 'bun',
      minify: true,
      plugins: [cssPlugin],
    });
    if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
    return await Bun.file(join(dir, 'out', 'probe.css')).text();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The project's own stylesheet, built the way the client build builds it.
 * Used for rules that are NOT Tailwind utilities — a hand-written rule that
 * silently fails to survive the plugin chain is invisible in review.
 */
async function buildProjectStylesheet(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ompchamber-tw-'));
  try {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, '../../../client/tailwind.css')],
      outdir: join(dir, 'out'),
      target: 'bun',
      minify: true,
      plugins: [cssPlugin],
    });
    if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
    return await Bun.file(result.outputs[0].path).text();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('css plugin — nested at-rules reach the browser flattened', () => {
  test('a placeholder colour refinement survives as a top-level @supports', async () => {
    const out = await buildThroughPlugin(`.probe::placeholder {
  color: var(--color-ink);
  @supports (color: color-mix(in lab, red, red)) {
    color: color-mix(in oklab, var(--color-ink) 40%, transparent);
  }
}
`);

    // No `&` anywhere: a nested rule under `::placeholder` is inert in Chrome,
    // which leaves the rule's full-opacity fallback as the final colour.
    expect(out).not.toMatch(/(?<!\\)&/);
    expect(out).toContain('@supports');
    expect(out).toContain('::placeholder');
    expect(out).toContain('40%');
  });

  test('a scrollbar thumb keeps its translucent refinement', async () => {
    const out = await buildThroughPlugin(`::-webkit-scrollbar-thumb {
  background: var(--theme-ink);
  @supports (color: color-mix(in lab, red, red)) {
    background: color-mix(in srgb, var(--theme-ink) 20%, transparent);
  }
}
`);

    expect(out).not.toMatch(/(?<!\\)&/);
    expect(out).toContain('20%');
  });

  test('declarations written after the at-rule keep their order in the bundle', async () => {
    const out = await buildThroughPlugin(`.probe {
  background: var(--theme-ink);
  @supports (color: color-mix(in lab, red, red)) {
    background: color-mix(in srgb, var(--theme-ink) 20%, transparent);
  }
  border-radius: 3px;
}
`);

    // The trailing declaration must not be hoisted above the at-rule: that
    // would let the at-rule's `background` win over a later one.
    expect(out.indexOf('border-radius')).toBeGreaterThan(out.indexOf('@supports'));
    expect(out).not.toMatch(/(?<!\\)&/);
  });
});

/**
 * The reveal-on-touch counterparts. Tailwind v4 emits `group-hover:` inside
 * `@media (hover: hover)`, so a device with no cursor (which reports
 * `hover: none`) never applies it — the git rows' stage/discard buttons, the
 * queue rows' send/edit/remove, the editor tab close and the folder picker's
 * "Choose" all stayed hidden, present in the DOM but unreachable by finger.
 * The three hand-written rules below undo exactly that, and they only work
 * because they are UNLAYERED: Tailwind's `opacity-0` / `hidden` sit in the
 * `utilities` layer, and an unlayered rule wins over every layered one.
 * Layering them would make them no-ops, silently, on the only devices they
 * exist for.
 */
describe('css plugin — reveal-on-touch rules reach the browser', () => {
  /**
   * The at-rules enclosing `marker`, found by walking the minified sheet with
   * a stack: every `{` pushes what introduced it, every `}` pops. Asserting on
   * the enclosing context is the whole point — a rule that exists but sits
   * inside `@layer utilities` is a rule that loses the cascade.
   */
  function enclosingAtRules(css: string, marker: string): string[] {
    const at = css.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const stack: string[] = [];
    let buffer = '';
    for (let i = 0; i < at; i++) {
      const ch = css[i];
      if (ch === '{') {
        stack.push(buffer.trim());
        buffer = '';
      } else if (ch === '}') {
        stack.pop();
        buffer = '';
      } else {
        buffer += ch;
      }
    }
    return stack;
  }

  test('every reveal rule is emitted unlayered under @media (hover: none)', async () => {
    const out = await buildProjectStylesheet();
    // A control shown where there is no cursor (and made hit-testable: the
    // sidebar's swapped-in chevron ships `pointer-events-none` at rest).
    expect(enclosingAtRules(out, '.touch-visible{opacity:1;pointer-events:auto}'))
      .toEqual(['@media (hover:none)']);
    // The other half of a swap: the glyph a hover would take away.
    expect(enclosingAtRules(out, '.touch-hidden{opacity:0}'))
      .toEqual(['@media (hover:none)']);
    // A control revealed by `hidden group-hover:flex`.
    expect(enclosingAtRules(out, '.touch-shown-flex{display:flex}'))
      .toEqual(['@media (hover:none)']);
  });
});

/**
 * The collapsible-section reveal (Source Control's stash section).
 *
 * Its contract is spread over three rules that only work together: the wrapper
 * is the grid, the CHILD carries `min-height: 0` + `overflow: hidden` (without
 * which the track cannot collapse below the content's min-content size and the
 * section renders at full height with no animation), and the open state is a
 * `data-expanded` attribute rather than a swapped class. `grid-template-rows`
 * is also the one property here a minifier could be tempted to rewrite, so the
 * gate is the built sheet, not the source.
 */
describe('css plugin — the section reveal reaches the browser', () => {
  test('the wrapper, the child clamp and the open state all survive the build', async () => {
    const out = await buildProjectStylesheet();

    expect(out).toContain('.section-reveal{display:grid;grid-template-rows:0fr');
    expect(out).toContain('.section-reveal>*{overflow:hidden;min-height:0}');
    expect(out).toContain('.section-reveal[data-expanded=true]{grid-template-rows:1fr}');
    // Reduced motion turns off the transition, never the layout.
    expect(out).toContain('@media (prefers-reduced-motion:reduce){.section-reveal{transition:none}}');
  });
});
