/**
 * Regenerate the bundled Nerd Font symbols face.
 *
 * The terminal's private-use glyphs (powerline separators, devicons, Font
 * Awesome, Material Design icons) exist in no coding webfont, so Kabmo
 * ships a subset of Nerd Fonts' `SymbolsNerdFontMono` as the last entry in the
 * terminal's font stack. See `src/shared/lib/fonts/nerd-symbols.css` for why,
 * and `NOTICE.md` beside it for the icon-set licences.
 *
 * Run after upgrading the upstream font:
 *
 *   curl -sL -o /tmp/nf.zip \
 *     https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.zip
 *   unzip -o /tmp/nf.zip -d /tmp/nfsym SymbolsNerdFontMono-Regular.ttf
 *   bun run scripts/nerd-symbols-font.mjs /tmp/nfsym/SymbolsNerdFontMono-Regular.ttf
 *
 * Then bump the version in `NOTICE.md`.
 *
 * Requires `fonttools` with brotli for woff2 output:
 *   python3 -m pip install fonttools brotli
 *
 * The ranges below are the private-use areas the icon sets live in, plus the
 * handful of Nerd-specific codepoints outside them (U+23FB-23FE are the
 * powerline "extra" arrows, U+276C-2771 the prompt chevrons). They are the same
 * ranges `nerd-symbols.css` declares in its `unicode-range`, and the script
 * fails if the built font does not actually cover them — a subset that silently
 * dropped a range would render tofu with no error anywhere.
 *
 * The powerline separators (U+E0B0-E0B7) are then stretched to the terminal's
 * CELL BOX. Upstream draws them one em tall, but the terminal's cell is 15 px
 * at a 12 px font (the text face's ink plus the block padding in
 * `terminal-panel/fonts.ts`), so a separator ended 1.5 px above and below the
 * coloured run it terminates — the rounded end of a prompt segment read as a
 * small semicircle floating inside a taller rectangle. A real Nerd Font
 * installed on the machine draws them to its own line box (~1.2 em) and looks
 * right, which is why this only showed on a phone, where the bundled face is
 * the one that renders. The transform maps each glyph's ink to the cell box
 * measured from the same constants the renderer uses; `nerd-symbols.test.ts`
 * pins the result.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/shared/lib/fonts/symbols-nerd-font-mono.woff2');
const subsetTarget = `${target}.subset.woff2`;

/**
 * The cell box the separators must fill, in CSS px.
 *
 * These are the numbers `measureTerminalCell` produces for the bundled text
 * face at `TERMINAL_FONT_SIZE` (12 px Fira Code): ink ascent 8.26 + descent
 * 2.54 + 2.5 px above + 1 px below = 15 px, baseline `round(8.26 + 2.5)` = 11.
 * They are stated here because this script runs outside the browser and cannot
 * measure the text face; the test asserts the font against the same box.
 */
const FONT_SIZE_PX = 12;
const CELL_HEIGHT_PX = 15;
const BASELINE_PX = 11;
const CELL_WIDTH_PX = 8;

/**
 * The cell the Nerd Fonts separators are DRAWN for: the base font's advance,
 * 0.6 em (Fira Code). Upstream keeps a 1 em advance in the Mono variant but
 * draws the outline inside the first 0.6 em, so a right-aligned glyph (a
 * segment's start cap) sits at 0.4-1.0 em — past the terminal's 0.667 em cell,
 * where it is clipped to a sliver. Mapping the design cell onto the real cell
 * fixes the position; the width is left at the design ratio, which is what a
 * real Nerd Font does in the same cell.
 */
const DESIGN_CELL_EM = 0.6;

/** The powerline separators and half-circles, which must fill the cell. */
const POWERLINE_RANGE = 'U+E0B0-E0B7';

/** Ranges the stylesheet declares; the build must cover every one. */
const RANGES = [
  'U+E000-F8FF',
  'U+F0000-FFFFD',
  'U+23FB-23FE',
  'U+2630',
  'U+2665',
  'U+26A1',
  'U+276C-2771',
  'U+2B58',
];

const source = process.argv[2];
if (!source) {
  console.error('usage: bun run scripts/nerd-symbols-font.mjs <SymbolsNerdFontMono-Regular.ttf>');
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`source font not found: ${source}`);
  process.exit(1);
}

// `--layout-features=''` drops the icon font's GSUB/GPOS tables (there is no
// shaping to do for one-glyph-per-codepoint symbols) and `--no-hinting` drops
// the TT hinting programs, which only matter at the pixel sizes a terminal
// never uses. Both are what make the subset smaller than the upstream file.
const subset = Bun.spawnSync([
  'pyftsubset',
  source,
  `--unicodes=${RANGES.join(',')}`,
  '--flavor=woff2',
  '--layout-features=',
  '--no-hinting',
  '--desubroutinize',
  `--output-file=${subsetTarget}`,
]);

if (subset.exitCode !== 0) {
  console.error(subset.stderr.toString().trim() || `pyftsubset exited ${subset.exitCode}`);
  console.error('\nIs fonttools installed?  python3 -m pip install fonttools brotli');
  process.exit(1);
}

// Stretch the powerline separators to the cell box. The transform reads each
// glyph's own ink bounds and maps them onto the box, so an upstream redraw of
// the separators still lands on the cell instead of on a hard-coded scale.
const scale = Bun.spawnSync([
  'python3',
  '-c',
  `
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

src, dst = sys.argv[1], sys.argv[2]
font_size_px = ${FONT_SIZE_PX}
cell_height_px = ${CELL_HEIGHT_PX}
cell_width_px = ${CELL_WIDTH_PX}
baseline_px = ${BASELINE_PX}
design_cell_em = ${DESIGN_CELL_EM}
start, _, end = ${JSON.stringify(POWERLINE_RANGE)}.removeprefix('U+').partition('-')
powerline = range(int(start, 16), int(end, 16) + 1)

font = TTFont(src)
upm = font['head'].unitsPerEm
units_per_px = upm / font_size_px
top = baseline_px * units_per_px
bottom = (baseline_px - cell_height_px) * units_per_px
design_cell = design_cell_em * upm
cell_width = cell_width_px * units_per_px
scale_x = cell_width / design_cell
# A right-aligned glyph (a segment's start cap) is drawn at 0.4-1.0 em in the
# 1 em advance; move it onto the design cell before scaling.
right_shift = -(upm - design_cell)
glyf = font['glyf']
cmap = font.getBestCmap()
for cp in powerline:
    name = cmap.get(cp)
    if name is None:
        continue
    pen = BoundsPen(None)
    glyf[name].draw(pen, glyf)
    if pen.bounds is None:
        continue
    x0, y0, x1, y1 = pen.bounds
    shift_x = right_shift if x1 > 0.9 * upm else 0.0
    scale_y = (top - bottom) / (y1 - y0)
    shift_y = bottom - y0 * scale_y
    out = TTGlyphPen(glyf)
    glyf[name].draw(TransformPen(out, (scale_x, 0, 0, scale_y, shift_x * scale_x, shift_y)), glyf)
    glyf[name] = out.glyph()
font.save(dst)
`,
  subsetTarget,
  target,
]);

rmSync(subsetTarget, { force: true });

if (scale.exitCode !== 0) {
  console.error(scale.stderr.toString().trim() || `powerline scale exited ${scale.exitCode}`);
  process.exit(1);
}

// Verify coverage rather than trusting the exit code: a range typo would
// otherwise produce a font that renders tofu with nothing to say so.
const verify = Bun.spawnSync([
  'python3',
  '-c',
  `
import sys
from fontTools.ttLib import TTFont

font = TTFont(${JSON.stringify(target)})
cmap = set(font.getBestCmap())
spec = ${JSON.stringify(RANGES)}

missing = []
for entry in spec:
    # Only the START carries the 'U+' prefix ('U+E000-F8FF'); the end is bare
    # hex, so it must not be sliced by a fixed offset.
    start, _, end = entry.partition('-')
    lo = int(start.removeprefix('U+'), 16)
    hi = int(end.removeprefix('U+'), 16) if end else lo
    # A range is covered when it contributes glyphs; every one of these does.
    if not any(cp in cmap for cp in range(lo, hi + 1)):
        missing.append(entry)

if missing:
    print('ranges with no glyphs: ' + ', '.join(missing), file=sys.stderr)
    sys.exit(1)

required = [0xE0B0, 0xE0B4, 0xE0B6, 0xE606, 0xE7A8, 0xF015, 0xF03E, 0xF121B, 0xF0001]
absent = [hex(cp) for cp in required if cp not in cmap]
if absent:
    print('missing representative glyphs: ' + ', '.join(absent), file=sys.stderr)
    sys.exit(1)

print(f'{len(cmap)} codepoints, {len(required)} representative glyphs present')
`,
]);

if (verify.exitCode !== 0) {
  console.error(verify.stderr.toString().trim());
  process.exit(1);
}

const size = readFileSync(target).byteLength;
console.log(`${basename(target)}: ${(size / 1024).toFixed(0)} kB — ${verify.stdout.toString().trim()}`);
console.log(`ranges: ${RANGES.join(', ')}`);
