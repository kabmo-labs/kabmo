import { mixHex } from '@/shared/lib/theme/color';
import { resolveTheme } from '@/shared/lib/theme/catalog';

/**
 * The terminal palette for a theme, derived from the same eight colors the rest
 * of the app paints with.
 *
 * The palette is applied when the WASM terminal is created: ANSI cells carry
 * RGB resolved at parse time, so a running terminal cannot simply be recolored
 * (see the theme rebuild in `terminal-panel/mount.ts`). Every blend is computed
 * here in hex — the canvas renderer understands literal colors, not
 * `color-mix()`.
 *
 * ANSI slots map onto the semantic colors the palette does carry (red=error,
 * green=success, yellow=warning, blue=info, magenta=accent); `cyan` has no
 * counterpart, so it is a deterministic mix of info and success, and the
 * grayscale slots are mixes of ink over canvas. "Bright" variants mix 20% toward
 * the foreground, which is lighter on a dark theme and darker on a light one —
 * the direction that increases contrast on both.
 */
export function getTerminalTheme(themeId: string) {
  const palette = resolveTheme(themeId);
  const { canvas, ink, paper } = palette;

  const towardInk = (color: string) => mixHex(color, ink, 0.2);
  const grayscale = (ratio: number) => mixHex(canvas, ink, ratio);

  // Two slots the canvas renderer paints OPAQUELY, so their values are
  // deliberate departures from xterm's:
  // - `selectionBackground` is a 28% ink-over-canvas gray rather than a
  //   translucent wash. The renderer's selection branch does
  //   `fillRect(...)` with the raw color — no alpha is applied and an
  //   `rgba()` value is NOT parsed (see the renderer's selection branch,
  //   which reads `this.theme.selectionBackground` directly) — so a
  //   translucent value would paint as the literal CSS color, and a light
  //   wash would vanish against the canvas. Opaque + mixed keeps the
  //   selection visible on every theme.
  // - `cursor: palette.meta` is the theme's own accent rather than xterm's
  //   `cursor: ink`. The block cursor is a filled rect in the meta color
  //   with `cursorAccent` drawn through the glyph, so the blink reads on
  //   both light and dark palettes without a second constant.
  //
  // `background` is TRANSPARENT: the terminal has no surface of its own.
  //
  // It used to be `canvas`, a slightly darker rectangle that also stopped a cell
  // short of the panel on the right (the fit addon reserves 15 px for its
  // in-canvas scrollbar) — measured as a terminal that was not full width.
  // Painting the panel's `paper` fixed the colour mismatch but still drew a
  // surface over the panel's material, which under `[data-surface="glass"]` is
  // the frosted chrome (`glass.css` makes the view ROOT transparent for exactly
  // this reason). Transparent lets that chrome — and the aura behind it — show
  // through the canvas; the classic look is unchanged because the chrome's own
  // fill is `--theme-paper` there. `renderLine` clears each row before filling,
  // so a transparent ground leaves the previous frame erased, not smeared.
  //
  // `cursorAccent` stays `paper`: it is the glyph drawn INSIDE the dark cursor
  // block, so it needs a real colour, not the surface.
  return {
    background: 'transparent',
    foreground: ink,
    cursor: palette.meta,
    cursorAccent: paper,
    selectionBackground: grayscale(0.28),
    selectionForeground: ink,
    black: grayscale(0.2),
    red: palette.error,
    green: palette.success,
    yellow: palette.warning,
    blue: palette.info,
    magenta: palette.meta,
    cyan: mixHex(palette.info, palette.success, 0.5),
    white: grayscale(0.75),
    brightBlack: grayscale(0.5),
    brightRed: towardInk(palette.error),
    brightGreen: towardInk(palette.success),
    brightYellow: towardInk(palette.warning),
    brightBlue: towardInk(palette.info),
    brightMagenta: towardInk(palette.meta),
    brightCyan: towardInk(mixHex(palette.info, palette.success, 0.5)),
    brightWhite: grayscale(0.92),
  };
}

/** The text face the renderer measures its cell width from. */
export const TERMINAL_TEXT_FAMILY = 'Fira Code';

/**
 * Font stack for the terminal canvas.
 *
 * The glyph fallbacks after the text faces are load-bearing. A shell prompt is
 * usually drawn with private-use symbols (powerline separators, devicons,
 * Material Design icons) that **no** coding webfont contains — `@fontsource/
 * fira-code`'s latin subset maps 226 codepoints and not one of them is above
 * U+FFFF — so without a face that supplies them the browser paints a hollow
 * tofu box for every prompt segment.
 *
 * The entries before the last one name the Nerd Font families a user is most
 * likely to have installed (plus the *fontconfig* symbol faces on Linux); a
 * face that is absent is simply skipped by the normal fallback chain, so
 * listing many costs nothing.
 *
 * `'Kabmo Nerd Symbols'` is the one Kabmo bundles itself
 * (`src/shared/lib/fonts/nerd-symbols.css`), and it is deliberately LAST: a
 * machine that already has a Nerd Font renders from it and never fetches these
 * bytes, while a phone — which has none — falls through to it instead of
 * painting tofu.
 *
 * Only glyphs the text face lacks reach these entries, so Latin metrics are
 * untouched.
 */
export const TERMINAL_GLYPH_FALLBACKS =
  "'FiraCode Nerd Font Mono', 'FiraCode Nerd Font', 'JetBrainsMono Nerd Font', " +
  "'JetBrainsMono NF', 'JetBrains Mono Nerd Font', 'Hack Nerd Font', 'MesloLGS NF', " +
  "'MesloLGM Nerd Font', 'CaskaydiaCove Nerd Font', 'SauceCodePro Nerd Font', " +
  "'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'PowerlineSymbols'";

/**
 * The bundled symbols face, kept separate so `mount.ts` can await/watch it by
 * name.
 *
 * It must stay last in the stack (see above) and its family name must match the
 * `@font-face` in `nerd-symbols.css` — the two are one contract, which is why
 * the name is a constant rather than a literal in each file.
 */
export const NERD_SYMBOLS_FAMILY = 'Kabmo Nerd Symbols';

/** The faces whose late arrival changes what the canvas should rasterize. */
export const TERMINAL_FACES = [TERMINAL_TEXT_FAMILY, NERD_SYMBOLS_FAMILY] as const;

/**
 * The canvas renderer composes its font string as `[italic ][bold ]SIZE FAMILY`
 * when a cell is bold, and the shorthand grammar allows ONE weight before the
 * size — not one per family — so the stack cannot ask for a real 700 per
 * face (`'Fira Code';700` is not a valid family token and the whole
 * declaration is dropped, leaving the renderer's `monospace` default). Bold
 * therefore goes through the CSS font-matching rules: the first family that
 * SHIPS a 700 wins, and `@fontsource/fira-code` does — `fira-code-fonts.css`
 * bundles 400/500/600/700 — so bold cells rasterize from the real 700 and
 * match xterm. Verified in Chromium: `bold 12px 'Fira Code', …` with the 700
 * face unloaded reports `12px "Fira Code"` (the 400 face) and downloads
 * `fira-code-latin-700-normal.woff2` the moment a bold cell is laid out.
 */
export const TERMINAL_FONT_FAMILY =
  `'${TERMINAL_TEXT_FAMILY}', ${TERMINAL_GLYPH_FALLBACKS}, '${NERD_SYMBOLS_FAMILY}', Menlo, Monaco, 'Courier New', monospace`;

/**
 * The cell font size in CSS px.
 *
 * 12px is a measured choice: the right panel is ~350 px wide at its default
 * width, and 12px keeps a normal prompt unwrapped. The renderer has no
 * `lineHeight` option, so the cell box is measured instead — `measureTerminalCell`
 * in `terminal-panel/fonts.ts` takes the font's line box (16 px here) plus 2 px
 * on each side and centres the glyph ink in it: 20 px per cell, which is what a
 * painted background block needs to read as a rectangle rather than a band.
 */
export const TERMINAL_FONT_SIZE = 12;

/**
 * Ghostty's `max_scrollback` is a BYTE budget, not a line count.
 *
 * The wrapper types it as lines and passes xterm's `scrollback: 10000` through
 * unchanged, which retains roughly 600 rows at a 98-column panel (measured).
 * Kabmo wants xterm's old 10,000-line depth, so the budget is stated in the
 * renderer's own unit.
 *
 * Ghostty charges roughly one 16-byte cell per retained column, so
 * `lines × cols × 16` is the deliberate over-estimate: at 100 columns it is
 * 16 MB for 10,000 lines, and the byte cap trims earlier only if the estimate
 * is too small. The server's replay history is capped separately at 512 KiB
 * (`lib/terminal/history.ts`), so a reconnect is bounded regardless.
 */
export const TERMINAL_SCROLLBACK_CELL_BYTES = 16;
export const TERMINAL_SCROLLBACK_LINES = 10_000;

export function scrollbackBytesForLines(lines: number, cols: number): number {
  return Math.max(1, lines) * Math.max(1, cols) * TERMINAL_SCROLLBACK_CELL_BYTES;
}

/** The default budget: 10,000 lines at the panel's usual 100 columns. */
export const TERMINAL_SCROLLBACK_BYTES = scrollbackBytesForLines(TERMINAL_SCROLLBACK_LINES, 100);
