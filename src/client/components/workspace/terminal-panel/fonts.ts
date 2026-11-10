/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Font readiness for the terminal canvas.
 *
 * The renderer measures its cell box when the terminal opens. Measuring against
 * a fallback face gives the grid the wrong width, and a phone has no installed
 * Nerd Font to fall through to. A face that lands later is not fatal: the
 * caller re-measures and fits.
 */

import type { Terminal } from 'ghostty-web';
import {
  TERMINAL_FACES,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_TEXT_FAMILY,
} from '@/client/data/theme/terminal';

const FONT_LOAD_TIMEOUT_MS = 2000;

/**
 * Wait for the text face, bounded by a timeout.
 *
 * Only the text face is loaded explicitly: the renderer measures `M` for its
 * cell width, and that glyph comes from the text face. Asking for the bundled
 * symbols face here would force its 1.1 MB download on every machine, including
 * the ones whose own Nerd Font the fallback chain would have used — the
 * `@font-face` is deliberately lazy. PUA glyphs that arrive late are repainted
 * by `watchTerminalFonts`.
 */
export async function waitForTerminalFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const timeout = Promise.withResolvers<void>();
  const timer = setTimeout(timeout.resolve, FONT_LOAD_TIMEOUT_MS);
  try {
    await Promise.race([
      document.fonts.load(`${TERMINAL_FONT_SIZE}px "${TERMINAL_TEXT_FAMILY}"`).then(
        () => undefined,
        () => undefined,
      ),
      timeout.promise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call `onLoaded` when one of the terminal's faces lands late.
 *
 * Returns a disposer.
 */
export function watchTerminalFonts(onLoaded: () => void): () => void {
  if (typeof document === 'undefined' || !document.fonts) return () => {};
  const faces = new Set<string>(TERMINAL_FACES);
  const listener = (event: FontFaceSetLoadEvent) => {
    const loaded = [...event.fontfaces].some((face) =>
      faces.has(face.family.replace(/['"]/g, '').trim()),
    );
    if (loaded) onLoaded();
  };
  document.fonts.addEventListener('loadingdone', listener);
  return () => document.fonts.removeEventListener('loadingdone', listener);
}

/** One cell's box in CSS px, as the canvas renderer needs it. */
export interface TerminalCellMetrics {
  width: number;
  height: number;
  baseline: number;
}

/**
 * Block padding above the ink's ascent and below its descent, in CSS px.
 *
 * Measured against the glyph ink, not the em box: the rectangle a person sees
 * around a coloured run is compared to the letters, so these are the numbers
 * chosen on the real panel — 4 over 1, which puts the letters high in the
 * rectangle; the 1 px below is still enough for a `g`/`y`/`p` descender (2.54)
 * because the row's own padding is measured from the *ink*, not the baseline.
 */
const CELL_PADDING_TOP_PX = 4;
const CELL_PADDING_BOTTOM_PX = 1;

/**
 * Measure the cell box from the font's real ink, not one glyph's.
 *
 * ghostty-web's own `measureFont` measures `M` alone. `M` has no descender, so
 * it substitutes `0.2em`, and the box comes out **13 px** at 12 px Fira Code
 * (ink ascent 8.3, baseline 10, cell ends at 13). A `g`/`y`/`p` descender then
 * ends on the row's last pixel, and since every row is repainted with the theme
 * background before its cells (`renderLine`), the next row's fill clips whatever
 * hangs below — measured: a `\e[41m` block around `ggyypp` had 0 px of block
 * under the descenders, and every coloured block read as cropped.
 *
 * Measuring `Mg` supplies a real descent, and the box is the ink plus the two
 * paddings above: at 12 px Fira Code (ink 8.26 / 2.54) that is `height = 16`
 * and `baseline = 12`, i.e. 4 px of block above the cap and 1 px below the
 * descender. The box is deliberately not the font's line box (line box plus
 * padding came out 20 px, which read as too loose on the real panel).
 */
export function measureTerminalCell(fontSize: number, fontFamily: string): TerminalCellMetrics {
  // The fallback is the CSS default ratio, used when there is no canvas to
  // measure against (a unit test, a non-DOM import).
  const fallbackAscent = fontSize * 0.8;
  const fallbackDescent = fontSize * 0.2;
  let width = Math.ceil(fontSize * 0.6);
  let ascent = fallbackAscent;
  let descent = fallbackDescent;
  const context =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (context) {
    context.font = `${fontSize}px ${fontFamily}`;
    width = Math.ceil(context.measureText('M').width) || width;
    const ink = context.measureText('Mg');
    ascent = ink.actualBoundingBoxAscent || fallbackAscent;
    descent = ink.actualBoundingBoxDescent || fallbackDescent;
  }
  return {
    width,
    height: Math.round(ascent + descent) + CELL_PADDING_TOP_PX + CELL_PADDING_BOTTOM_PX,
    baseline: Math.round(ascent + CELL_PADDING_TOP_PX),
  };
}

/** The private end of `CanvasRenderer` this module corrects. */
interface MetricsRenderer {
  measureFont: () => TerminalCellMetrics;
  remeasureFont: () => void;
}

/**
 * Give the renderer a cell box that holds a descender.
 *
 * `CanvasRenderer.measureFont` and the field it writes are private, and the
 * cell height it derives from `M` leaves a descender on the row's last pixel
 * (see `measureTerminalCell`). Replacing the instance method and re-measuring
 * is the only way to correct it without patching the dependency:
 * `remeasureFont()` calls `this.measureFont()`, and every consumer — fit,
 * `resize`, `render`, the mouse-report cell size — reads `getMetrics()`.
 *
 * The override reads `term.options`, so the font-size round-trip in
 * `watchTerminalFonts` re-measures with this rule instead of restoring the
 * vendor's 13 px box.
 */
export function installCellMetrics(term: Terminal): void {
  const renderer = term.renderer as unknown as MetricsRenderer | undefined;
  if (!renderer) return;
  renderer.measureFont = () =>
    measureTerminalCell(
      term.options.fontSize ?? TERMINAL_FONT_SIZE,
      term.options.fontFamily ?? TERMINAL_FONT_FAMILY,
    );
  renderer.remeasureFont();
}
