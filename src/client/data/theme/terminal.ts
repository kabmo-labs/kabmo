import { mixHex } from '@/shared/lib/theme/color';
import { resolveTheme } from '@/shared/lib/theme/catalog';

/**
 * The terminal palette for a theme, derived from the same eight colors the rest
 * of the app paints with.
 *
 * xterm parses its own colors and understands only literal notations (hex,
 * `rgb()`, `hsl()`, named) — `color-mix()` is not among them in either the DOM
 * or the WebGL renderer — so every blend is computed here in hex instead of
 * being left to CSS. The result follows the active theme rather than a fixed
 * light/dark pair: a Nord terminal is Nord, and switching themes repaints the
 * scrollback instead of leaving the previous palette on screen.
 *
 * ANSI slots map onto the semantic colors the palette does carry (red=error,
 * green=success, yellow=warning, blue=info, magenta=accent); `cyan` has no
 * counterpart, so it is a deterministic mix of info and success, and the
 * grayscale slots are mixes of ink over canvas. "Bright" variants mix 20% toward
 * the foreground, which is lighter on a dark theme and darker on a light one —
 * the direction that increases contrast on both.
 */
export function getXtermTheme(themeId: string) {
  const palette = resolveTheme(themeId);
  const { canvas, ink } = palette;

  const towardInk = (color: string) => mixHex(color, ink, 0.2);
  const grayscale = (ratio: number) => mixHex(canvas, ink, ratio);

  return {
    background: canvas,
    foreground: ink,
    cursor: palette.meta,
    cursorAccent: canvas,
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
 * painting tofu. Verified: with the bundled face last and a local Nerd Font
 * ahead of it, laying out a PUA glyph issued zero font requests; with no local
 * family present, the face is fetched and all of the prompt's codepoints
 * render.
 *
 * Only glyphs the text face lacks reach these entries, so Latin metrics are
 * untouched — verified: `A`/`m`/`W` keep identical advance and ink.
 */
export const XTERM_GLYPH_FALLBACKS =
  "'FiraCode Nerd Font Mono', 'FiraCode Nerd Font', 'JetBrainsMono Nerd Font', " +
  "'JetBrainsMono NF', 'JetBrains Mono Nerd Font', 'Hack Nerd Font', 'MesloLGS NF', " +
  "'MesloLGM Nerd Font', 'CaskaydiaCove Nerd Font', 'SauceCodePro Nerd Font', " +
  "'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'PowerlineSymbols'";

/**
 * The bundled symbols face, kept separate so `mount.ts` can await it by name.
 *
 * It must stay last in the stack (see above) and its family name must match the
 * `@font-face` in `nerd-symbols.css` — the two are one contract, which is why
 * the name is a constant rather than a literal in each file.
 */
export const NERD_SYMBOLS_FAMILY = 'Kabmo Nerd Symbols';

export const XTERM_FONT_FAMILY =
  `'Fira Code', ${XTERM_GLYPH_FALLBACKS}, '${NERD_SYMBOLS_FAMILY}', Menlo, Monaco, 'Courier New', monospace`;

/** xterm's private render service, read only to size-check before fitting. */
export interface XtermCore {
  _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } };
}

/** Interop shape of the dynamically imported xterm modules: the class sits at
 *  the root export on some builds and under `.default` on others. */
export interface XtermModule<T> {
  Terminal?: T;
  FitAddon?: T;
  default?: { Terminal?: T; FitAddon?: T } & T;
}

export function safePatchFitAddon(FitAddonClass: any) {
  try {
    const fitProto = FitAddonClass?.prototype;
    if (fitProto && !fitProto.__safePatched) {
      fitProto.__safePatched = true;
      const origPropose = fitProto.proposeDimensions;
      fitProto.proposeDimensions = function () {
        try {
          const core = this._terminal?._core;
          if (!core?._renderService) return undefined;
          const dims = core._renderService.dimensions;
          if (!dims?.css?.cell?.width || !dims?.css?.cell?.height) return undefined;
          return origPropose?.call(this);
        } catch {
          return undefined;
        }
      };
    }
  } catch {}
}

const DEFAULT_DIMENSIONS = {
  device: { char: { width: 9, height: 17, left: 0, top: 0 }, cell: { width: 9, height: 17 }, canvas: { width: 0, height: 0 } },
  css: { canvas: { width: 0, height: 0 }, cell: { width: 9, height: 17 } }
};

export function safePatchRenderService(term: any) {
  try {
    const core = term?._core;
    if (core?._renderService) {
      const proto = Object.getPrototypeOf(core._renderService);
      const desc = Object.getOwnPropertyDescriptor(proto, 'dimensions');
      if (desc?.get && !proto.__safePatched) {
        proto.__safePatched = true;
        const origGet = desc.get;
        Object.defineProperty(proto, 'dimensions', {
          get() {
            try {
              if (!this._renderer?.value) return DEFAULT_DIMENSIONS;
              return origGet.call(this);
            } catch {
              return DEFAULT_DIMENSIONS;
            }
          },
          configurable: true,
          enumerable: true
        });
      }
    }
  } catch {}
}
