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
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/shared/lib/fonts/symbols-nerd-font-mono.woff2');

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
  `--output-file=${target}`,
]);

if (subset.exitCode !== 0) {
  console.error(subset.stderr.toString().trim() || `pyftsubset exited ${subset.exitCode}`);
  console.error('\nIs fonttools installed?  python3 -m pip install fonttools brotli');
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
