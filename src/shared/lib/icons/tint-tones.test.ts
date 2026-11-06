/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two solved tone tables, and the properties each one has to keep.
 *
 * Split out of `tint.test.ts` because it asserts a different thing: that file
 * pins which hue a glyph GETS (the hash, the class, the signal table), while this
 * one pins how a hue is PAINTED — per variant, contrast-safe on every palette of
 * that variant, inside a narrow lightness band, and identical in hue across the
 * two themes.
 */

import { describe, expect, test } from 'bun:test';
import {
  assignPanelHues,
  DEFAULT_ICON_HUE,
  ICON_HUE_PAINT,
  ICON_HUE_ROWS,
  ICON_TINTS,
  iconHue,
  hashHue,
  iconHuePaint,
  iconTone,
} from '@/shared/lib/icons/tint';
import { ICON_HUES, ICON_TONES, ICON_TONES_DARK } from '@/shared/lib/icons/tint-hues.generated';
import { oklchOf, PAPER_BUCKETS, paperBucketOf } from '@/shared/lib/icons/icon-tone';
import { THEMES } from '@/shared/lib/theme/catalog';
import { BRAND_CONTRAST_FLOOR, contrastRatio } from '@/shared/lib/theme/legibility';

/** `hsl(<hue> <sat>% <light>%)` as a hex, so contrast can be measured. */
function hslHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(channel(0))}${toHex(channel(8))}${toHex(channel(4))}`;
}

describe('the generated hues', () => {
  test('the table has one entry per imported, non-signal icon', () => {
    expect(Object.keys(ICON_HUES).length).toBeGreaterThan(100);
    for (const name of Object.keys(ICON_TINTS)) {
      expect(ICON_HUES[name], `${name} is a signal and must not carry a hue`).toBeUndefined();
    }
  });

  test('every hue is a step on the 36-hue wheel', () => {
    for (const [name, hue] of Object.entries(ICON_HUES)) {
      expect(hue % 10, name).toBe(0);
      expect(hue, name).toBeGreaterThanOrEqual(0);
      expect(hue, name).toBeLessThan(360);
    }
  });

  test('neighbouring icons are not all the same colour', () => {
    const hues = new Set(Object.values(ICON_HUES));
    // The whole point of a per-icon hue: a dense list must not be one colour.
    expect(hues.size).toBeGreaterThan(20);
  });

  test('the hue table matches the icons this repo imports', async () => {
    // The generator is the source of truth; running its `--check` here is what
    // makes a stale table a test failure instead of a review miss.
    //
    // `Bun.fileURLToPath`, not `URL.pathname`: on a Windows host the pathname
    // is `/D:/a/kabmo/kabmo/`, which no process can open, so the spawn failed
    // for a reason that had nothing to do with the table — measured on the
    // Windows gate, where this case failed while every other row passed.
    //
    // The script is resolved THROUGH the URL rather than by string-joining onto
    // the directory: `fileURLToPath` keeps a trailing separator (`…/kabmo/`),
    // and a hand-written join would then carry one separator style into a path
    // the other half spelled the other way.
    const repoUrl = new URL('../../../..', import.meta.url);
    const repoRoot = Bun.fileURLToPath(repoUrl);
    const script = Bun.fileURLToPath(new URL('scripts/icon-tints.mjs', repoUrl));
    const check = Bun.spawnSync(['bun', 'run', script, '--check'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(check.exitCode, check.stderr.toString()).toBe(0);
  });

  test('every light tone clears the floor on every paper of ITS OWN bucket', () => {
    // The light table is split by paper bucket, and that split is only legal
    // because each bucket is solved against its own darkest paper. Clearing the
    // floor on the catalog's darkest paper instead would make the buckets
    // pointless; clearing it only against the bucket's paper is what makes a
    // brighter palette paint a brighter icon.
    for (const bucket of PAPER_BUCKETS) {
      const papers = THEMES.filter((theme) => theme.variant === 'light' && paperBucketOf(theme.paper) === bucket).map(
        (theme) => theme.paper,
      );
      expect(papers.length, `${bucket} has palettes`).toBeGreaterThan(0);
      for (const [hue, tone] of Object.entries(ICON_TONES[bucket])) {
        expect(tone, `${bucket} ${hue}`).toMatch(/^#[0-9a-f]{6}$/);
        const worst = Math.min(...papers.map((paper) => contrastRatio(tone, paper)));
        expect(worst, `${bucket} hue ${hue} (${tone})`).toBeGreaterThanOrEqual(BRAND_CONTRAST_FLOOR);
      }
    }
  });

  test('every dark tone clears the floor on every dark palette', () => {
    // Dark used to be ONE `hsl(H 65% 70%)` for every hue and was deliberately
    // left alone. Measured, that pair spreads its lightness over 0.25 (L 0.65 at
    // hue 240 against 0.90 at hue 60) and leaves the muddiest row at a quarter
    // of the vividest row's chroma — the same "kusam" the light side was
    // reported for, one variant later. It is solved now, and this pins the
    // property the solve must keep.
    const papers = THEMES.filter((theme) => theme.variant === 'dark').map((theme) => theme.paper);
    for (const [hue, tone] of Object.entries(ICON_TONES_DARK)) {
      expect(tone, hue).toMatch(/^#[0-9a-f]{6}$/);
      const worst = Math.min(...papers.map((paper) => contrastRatio(tone, paper)));
      expect(worst, `hue ${hue} (${tone})`).toBeGreaterThanOrEqual(BRAND_CONTRAST_FLOOR);
    }
  });

  test('each variant lands in a narrow lightness band and carries real chroma', () => {
    // The whole point of solving per hue in BOTH variants: one pair per side made
    // the wheel uneven — a blue icon visibly heavier than the yellow beside it.
    // Measured after the solve, light spreads 0.04 and dark 0.08, and the
    // muddiest dark row goes from chroma 0.082 to 0.133.
    const tables: ReadonlyArray<readonly [string, Readonly<Record<number, string>>, number, number]> = [
      ...PAPER_BUCKETS.map((bucket) => [`light/${bucket}`, ICON_TONES[bucket], 0.06, 0.09] as const),
      ['dark', ICON_TONES_DARK, 0.1, 0.12] as const,
    ];
    for (const [label, table, maxSpread, minChroma] of tables) {
      const tones = Object.values(table).map((tone) => oklchOf(tone));
      const lightnesses = tones.map((tone) => tone.lightness);
      const spread = Math.max(...lightnesses) - Math.min(...lightnesses);
      expect(spread, `${label} lightness spread`).toBeLessThanOrEqual(maxSpread);
      expect(Math.min(...tones.map((tone) => tone.chroma)), `${label} dullest row`).toBeGreaterThanOrEqual(minChroma);
    }
  });

  test('a hue keeps its identity across variants', () => {
    // A glyph must be "the same colour" on both themes, or switching the palette
    // silently recolours every icon in the app.
    for (const hue of Object.keys(ICON_TONES.bright)) {
      const light = oklchOf(ICON_TONES.bright[Number(hue)]!).hue;
      const dark = oklchOf(ICON_TONES_DARK[Number(hue)]!).hue;
      const drift = Math.min(Math.abs(light - dark), 360 - Math.abs(light - dark));
      expect(drift, `hue ${hue}`).toBeLessThan(12);
    }
  });

  test('a light tone carries MORE chroma than the pair it replaced', () => {
    // The report — "warna icon di mode full color ketika light mode kelihatan
    // kusem" — is this measurement, and nothing else: the old pair maxed out at
    // OKLCH chroma 0.075 on the muddiest hue because one saturation had to suit
    // every hue on the wheel. Solving per hue is what buys the colour back, and
    // this is the assertion that would fail if a future edit quietly put a
    // uniform pair back.
    const hues = Object.keys(ICON_TONES.deepest).map(Number);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const before = hues.map((hue) => oklchOf(hslHex(hue, ICON_HUE_PAINT.light.saturation, ICON_HUE_PAINT.light.lightness)).chroma);
    const after = hues.map((hue) => oklchOf(ICON_TONES.deepest[hue]!).chroma);
    expect(mean(after)).toBeGreaterThan(mean(before) * 1.3);
    // Every single hue must improve — a table that traded one muddy row for
    // another would still pass the mean.
    for (const hue of hues) {
      expect(oklchOf(ICON_TONES.deepest[hue]!).chroma, `hue ${hue}`).toBeGreaterThan(
        oklchOf(hslHex(hue, ICON_HUE_PAINT.light.saturation, ICON_HUE_PAINT.light.lightness)).chroma,
      );
    }
  });

  test('a light tone keeps its hue, so a row does not change colour', () => {
    // Solved in OKLCH, but the hue is the OKLCH angle of the OLD paint: a tone
    // that drifted would recolour every icon in the app, which is not what
    // "more colour" means.
    for (const [hue, tone] of Object.entries(ICON_TONES.deepest)) {
      const before = oklchOf(hslHex(Number(hue), ICON_HUE_PAINT.light.saturation, ICON_HUE_PAINT.light.lightness)).hue;
      const after = oklchOf(tone).hue;
      const circular = Math.min(Math.abs(before - after), 360 - Math.abs(before - after));
      expect(circular, `hue ${hue} (${tone})`).toBeLessThan(12);
    }
  });

  test('the light tone is a table lookup, not a solve, and it snaps to the wheel', () => {
    // No paper means the deepest bucket: the conservative answer, not the
    // flattering one — a caller with no palette context still gets a legal colour.
    expect(iconTone(120)).toBe(ICON_TONES.deepest[120]!);
    // `hashHue` only produces wheel steps, but a stored or plugin name could
    // still reach here with something else; the nearest step keeps it a colour.
    expect(iconTone(124)).toBe(ICON_TONES.deepest[120]!);
    expect(iconTone(356)).toBe(ICON_TONES.deepest[0]!);
    expect(iconTone(-10)).toBe(ICON_TONES.deepest[350]!);
  });

  test('the paint rule and the concrete colour share one formula', () => {
    // The stylesheet leaves the hue to `--icon-hue`; the settings preview needs a
    // real colour. Both must come from the same numbers, or the preview lies.
    // Each variant reads its OWN solved table, which is why neither is a bare
    // `hsl()` any more.
    expect(iconHuePaint('light')).toBe(
      `var(--icon-tone, hsl(var(--icon-hue, ${DEFAULT_ICON_HUE}) ${ICON_HUE_PAINT.light.saturation}% ${ICON_HUE_PAINT.light.lightness}%))`,
    );
    expect(iconHuePaint('dark')).toBe(
      `var(--icon-tone-dark, hsl(var(--icon-hue, ${DEFAULT_ICON_HUE}) ${ICON_HUE_PAINT.dark.saturation}% ${ICON_HUE_PAINT.dark.lightness}%))`,
    );
    expect(iconTone(120, 'light')).toBe(ICON_TONES.deepest[120]!);
    expect(iconTone(120, 'dark')).toBe(ICON_TONES_DARK[120]!);
  });

  test('the table is exactly what the runtime hash produces', () => {
    // One formula for both: a plugin's mark is coloured by `hashHue` at runtime,
    // so if the generated rows drifted from it, an installed plugin would sit on
    // a different wheel than the glyphs beside it.
    for (const [name, hue] of Object.entries(ICON_HUES)) {
      expect(hashHue(name), name).toBe(hue);
    }
  });

  test('a plugin name gets a stable hue on the same wheel', () => {
    expect(hashHue('Demo Plugin')).toBe(hashHue('Demo Plugin'));
    expect(hashHue('Demo Plugin')).not.toBe(hashHue('Other Plugin'));
    for (const name of ['Demo', 'Session Info', 'git-forge', 'Stats — CPU & RAM']) {
      expect(hashHue(name) % 10, name).toBe(0);
      expect(hashHue(name), name).toBeLessThan(360);
    }
  });

  test('the rail gives every panel its OWN hue, even when two hashes collide', () => {
    // Fourteen buttons on a 36-slot wheel collide about nine times in ten
    // (birthday bound) — measured, three right-rail icons shared one blue.
    const ids = [
      'context', 'files', 'search', 'git', 'wiki', 'terminal', 'user-browser',
      'browser', 'usage', 'todo', 'plan', 'plugin:command-runner',
      'plugin:git-forge', 'plugin:stats',
    ];
    const hues = assignPanelHues(ids);

    expect(hues.size).toBe(ids.length);
    expect(new Set(hues.values()).size).toBe(ids.length);
  });

  test('the assignment does not depend on the catalog order', () => {
    // Reordering a rail must not recolour it: the ids are sorted before probing.
    const ids = ['b', 'a', 'c', 'plugin:x'];
    expect([...assignPanelHues(ids)]).toEqual([...assignPanelHues([...ids].reverse())]);
  });

  test('an unassigned panel falls back to the plain hash', () => {
    expect(assignPanelHues(['only']).get('only')).toBe(hashHue('only'));
  });

  test('an icon outside the table keeps a neutral default', () => {
    expect(iconHue('NotAnIcon')).toBe(DEFAULT_ICON_HUE);
    expect(iconHue('Trash2')).toBe(DEFAULT_ICON_HUE);
  });

  test('the rows name classes, one per hue', () => {
    const classes = ICON_HUE_ROWS.map((row) => row.className);
    expect(new Set(classes).size).toBe(classes.length);
    expect(classes.every((className) => className.startsWith('lucide-'))).toBe(true);
  });
});

describe('the paper buckets', () => {
  test('a brighter paper paints a brighter icon, monotonically', () => {
    // The whole reason the table is split. Measured over the shipped palettes:
    // deep 0.589, mid 0.624, bright 0.641, against dark's 0.782 and the old
    // single table's 0.589 on every light palette.
    const meanLightness = (bucket: (typeof PAPER_BUCKETS)[number]) => {
      const tones = Object.values(ICON_TONES[bucket]);
      return tones.reduce((sum, tone) => sum + oklchOf(tone).lightness, 0) / tones.length;
    };
    const values = PAPER_BUCKETS.map(meanLightness);
    // STRICTLY increasing: each bucket is solved against its own darkest paper, so
    // a brighter paper can never paint a darker icon. Measured across the six:
    // 0.590, 0.619, 0.629, 0.636, 0.644, 0.657.
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!, `${PAPER_BUCKETS[i]}`).toBeGreaterThan(values[i - 1]!);
    }
    expect(values[0]!).toBeLessThan(0.6);
  });

  test('every bucket groups the palettes it claims to', () => {
    // The buckets are ranges of RELATIVE LUMINANCE, which is the quantity
    // contrast is computed from. A paper on a boundary must land in exactly one
    // bucket, and every light palette must be reachable by one.
    for (const theme of THEMES.filter((entry) => entry.variant === 'light')) {
      const bucket = paperBucketOf(theme.paper);
      expect(PAPER_BUCKETS, `${theme.id}`).toContain(bucket);
    }
    // The catalog's darkest and lightest light papers land in different buckets,
    // which is what makes the split worth having.
    expect(paperBucketOf('#dee0ee')).toBe('deepest');
    expect(paperBucketOf('#ffffff')).toBe('bright');
  });

  test('a caller with no palette gets the deepest bucket', () => {
    // The conservative answer: a colour that every light palette clears, rather
    // than the flattering one that only a bright paper allows.
    expect(iconTone(120)).toBe(ICON_TONES.deepest[120]!);
    expect(iconTone(120, 'light', '#ffffff')).toBe(ICON_TONES.bright[120]!);
    expect(iconTone(120, 'light', '#faf8f3')).toBe(ICON_TONES.mid[120]!);
    // Dark has one band, so a paper cannot change it.
    expect(iconTone(120, 'dark', '#ffffff')).toBe(iconTone(120, 'dark', '#dee0ee'));
  });
});
