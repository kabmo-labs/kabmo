/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The terminal's Nerd Font coverage is one contract split across three files,
 * and every way it can break is silent at runtime:
 *
 * - The bundled face's family name is written twice — in the stack
 *   (`XTERM_FONT_FAMILY`) and in the `@font-face` (`nerd-symbols.css`). If they
 *   drift, the face loads and nothing uses it: prompts render as tofu boxes
 *   with no error anywhere.
 * - The face must stay LAST in the stack. Moved ahead of the installed families
 *   it would win on every machine, which both changes the glyph shapes a user
 *   with a Nerd Font already sees AND makes every desktop download 1.1 MB it
 *   never needed. That is a bandwidth regression with no visible symptom on the
 *   developer's own laptop.
 * - The font file and its `unicode-range` must agree. A range that names
 *   codepoints the subset dropped leaves those glyphs as tofu even though the
 *   face is loaded and "working".
 *
 * These assertions are cheap and each one pins a failure this change was made
 * to prevent, so they are permanent rather than throwaway.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NERD_SYMBOLS_FAMILY,
  XTERM_FONT_FAMILY,
  XTERM_GLYPH_FALLBACKS,
} from '@/client/data/theme/terminal';

const FONT_DIR = import.meta.dir;
const CSS = readFileSync(join(FONT_DIR, 'nerd-symbols.css'), 'utf8');
const WOFF2 = join(FONT_DIR, 'symbols-nerd-font-mono.woff2');
/** The app's UI stack (`--font-sans`), which paints the session-title card icon. */
const TAILWIND = readFileSync(join(FONT_DIR, '../../../client/tailwind.css'), 'utf8');

/** Parse `unicode-range: a, b, c;` into codepoint intervals. */
function declaredRanges(css: string): Array<[number, number]> {
  const block = css.match(/unicode-range:\s*([^;]+);/);
  if (!block) throw new Error('nerd-symbols.css declares no unicode-range');
  return block[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [start, end] = entry.split('-');
      const lo = Number.parseInt(start.replace(/^U\+/i, ''), 16);
      const hi = end ? Number.parseInt(end.replace(/^U\+/i, ''), 16) : lo;
      return [lo, hi] as [number, number];
    });
}

describe('bundled Nerd Font symbols face', () => {
  test('the stylesheet declares the family the terminal stack names', () => {
    const declared = CSS.match(/font-family:\s*'([^']+)'/)?.[1];
    expect(declared).toBe(NERD_SYMBOLS_FAMILY);
  });

  test('the face is LAST in the stack, after every installed family', () => {
    // A local Nerd Font must win, so the bundled face is only reached on a
    // machine that has none — which is also what keeps the desktop from
    // downloading it (its unicode-range is PUA-only, so it is never fetched
    // when another family supplies the glyph).
    expect(XTERM_FONT_FAMILY.indexOf(NERD_SYMBOLS_FAMILY)).toBeGreaterThan(
      XTERM_FONT_FAMILY.indexOf('PowerlineSymbols'),
    );
    // Only the generic fallbacks may follow it.
    const after = XTERM_FONT_FAMILY.slice(XTERM_FONT_FAMILY.indexOf(NERD_SYMBOLS_FAMILY));
    expect(after).not.toMatch(/Nerd Font Mono'/);
  });

  test('every installed family is still offered before the bundled one', () => {
    for (const family of ['FiraCode Nerd Font Mono', 'JetBrainsMono Nerd Font', 'Symbols Nerd Font Mono']) {
      expect(XTERM_GLYPH_FALLBACKS).toContain(family);
      expect(XTERM_FONT_FAMILY.indexOf(family)).toBeLessThan(
        XTERM_FONT_FAMILY.indexOf(NERD_SYMBOLS_FAMILY),
      );
    }
  });

  test('the subset actually covers the ranges the stylesheet claims', () => {
    // Reading the cmap needs fonttools, which is not a project dependency. The
    // absence is a legitimate skip; a *failure* of the probe is not, so the two
    // are told apart rather than both being swallowed as "no fonttools".
    //
    // The availability check gets its own bounded budget, and the test gets room
    // for it: on a Windows runner `python3` resolves to a slow launcher that took
    // the whole default 5s test budget just to answer "no fonttools", so the test
    // was reported as TIMED OUT after it had correctly decided to skip (measured
    // on windows-latest: 5009ms, with the skip message already printed). An
    // interpreter that cannot answer inside this budget counts as unavailable —
    // the skip this test already documents — rather than as a hang.
    const PYTHON_PROBE_TIMEOUT_MS = 5_000;
    const available = Bun.spawnSync({
      cmd: ['python3', '-c', 'import fontTools, brotli'],
      timeout: PYTHON_PROBE_TIMEOUT_MS,
    });
    if (available.exitCode !== 0) {
      console.warn('skipping font coverage check: python3 fonttools/brotli unavailable');
      return;
    }

    const probe = Bun.spawnSync([
      'python3',
      '-c',
      `
import json
from fontTools.ttLib import TTFont

cmap = set(TTFont(${JSON.stringify(WOFF2)}).getBestCmap())
ranges = ${JSON.stringify(declaredRanges(CSS))}
uncovered = [r for r in ranges if not any(cp in cmap for cp in range(r[0], r[1] + 1))]
# The prompt glyphs this face exists for.
required = [0xE0B0, 0xE0B4, 0xE0B6, 0xE606, 0xE7A8, 0xE718, 0xF015, 0xF03E, 0xF121B, 0xF0001]
print(json.dumps({ "codepoints": len(cmap), "uncovered": uncovered, "missing": [c for c in required if c not in cmap] }))
`,
    ]);

    // fonttools is known to be importable here, so a non-zero exit is a real
    // failure (a corrupt subset, a bad path) and must not read as a skip.
    expect(probe.stderr.toString()).toBe('');

    const result = JSON.parse(probe.stdout.toString()) as {
      codepoints: number;
      uncovered: Array<[number, number]>;
      missing: number[];
    };
    expect(result.uncovered).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.codepoints).toBeGreaterThan(10_000);
    // Room for the bounded availability probe above plus the cmap read; the
    // default 5s is what a slow Windows launcher consumed on its own.
  }, 20_000);

  test('the face file is present and non-trivial', async () => {
    const file = Bun.file(WOFF2);
    expect(await file.exists()).toBe(true);
    expect(file.size).toBeGreaterThan(100_000);
  });

  /**
   * The UI stack is the SECOND consumer of this face, and it was missing one.
   * omp heads a session title with a card icon — a PUA glyph
   * (`title.icons: nf+emoji`) that no Latin face contains — so a stack without
   * a Nerd Font renders it as tofu wherever the device has none (a phone). The
   * desktop only looked correct because Chromium's OS fallback found the
   * developer's installed Nerd Font; there is no such fallback on a phone.
   *
   * The order is what keeps it from being a bandwidth regression: the installed
   * families must precede the bundled face, or Chromium prefers the named
   * webfont over the system fallback and every machine downloads 1.1 MB.
   */
  test('the UI stack names a Nerd Font, with the bundled face LAST', () => {
    const stack = TAILWIND.match(/--font-sans:\s*([^;]+);/)?.[1];
    expect(stack).toBeDefined();
    // A title card must have SOME Nerd Font in the UI stack, or it is tofu on a phone.
    expect(stack!).toContain(NERD_SYMBOLS_FAMILY);
    // Installed families first, bundled face last: the terminal's own contract,
    // for the same reason (a machine that has one never fetches these bytes).
    // Both must be PRESENT (`indexOf` alone lets a missing name through, since
    // `-1 < anyPositive` is true).
    for (const family of ['FiraCode Nerd Font Mono', 'Symbols Nerd Font Mono']) {
      expect(stack!).toContain(family);
      expect(stack!.indexOf(family)).toBeLessThan(stack!.indexOf(NERD_SYMBOLS_FAMILY));
    }
    // Nothing may follow the bundled face — a later generic would be dead code.
    const after = stack!.slice(stack!.indexOf(NERD_SYMBOLS_FAMILY) + NERD_SYMBOLS_FAMILY.length);
    expect(after.replace(/["'\s,]/g, '')).toBe('');
  });
});
