/**
 * A plugin's mark.
 *
 * `icon` is OPTIONAL in the manifest, so a plugin may ship none — and a grid of
 * equally-sized cards makes an absent icon look like a broken one rather than a
 * choice. The fallback is therefore a real mark: the plugin's INITIALS, which
 * read as "this plugin has no icon" instead of "something failed to load".
 *
 * Every surface that draws a plugin — the activity bar, the navbar, the editor
 * tab, the store and installed cards — draws through this one component, so a
 * plugin cannot be a puzzle piece in one place and a letter in another. The
 * initials follow the same rule as the provider marks (`providerInitials`): one
 * per word, lowercased, closed with a dot, at most two — `Session Info` → `si.`.
 *
 * The mark is drawn at a fixed box regardless of what the plugin shipped. An
 * SVG with its own `width`/`height` attributes would otherwise take that size
 * and break the layout, so the element is constrained rather than the file
 * trusted.
 *
 * **A VECTOR mark is painted through a CSS mask, not an `<img>`.** An SVG loaded
 * through `<img>` is a separate document: it cannot resolve `currentColor`
 * against this page, so a plugin's `stroke="currentColor"` renders BLACK and a
 * baked colour renders that colour in EVERY state. Measured on a red-ink host:
 * the `<img>` path painted `0,0,0` where the mask painted `255,0,0`. That is
 * why a plugin's button kept one ink while its neighbours moved with the theme —
 * `rgb(138,138,138)` in both the inactive and the active state, against a
 * built-in's `text-ink/40` → `text-ink`.
 *
 * A mask has no document to inherit into, so the host supplies the paint and the
 * file supplies only its alpha channel. That paint is `var(--plugin-color,
 * currentColor)`: monochrome resolves to the ink the mask always used, and
 * `[data-icon-style="color"]` defines `--plugin-color` from a hue derived from
 * the plugin's own name — so a marketplace mark gets its own colour without the
 * host guessing one at build time, and without the component reading the mode
 * from JavaScript.
 *
 * A RASTER mark keeps the `<img>`. Masking a PNG or a JPEG would throw away its
 * colour — a brand logo the plugin chose to ship — and a JPEG has no alpha to
 * mask with, so it would paint the box solid. The ink rule is for vectors.
 */

import { providerInitials } from '@/shared/lib/models/provider/glyph';
import { hashHue, iconTone } from '@/shared/lib/icons/tint';
import { legiblePair } from '@/shared/lib/theme/legibility';

interface PluginMarkProps {
  name: string;
  /** The registry's content-addressed icon URL, when the plugin declares one. */
  iconUrl?: string;
  /**
   * The mark colour the plugin's manifest declares (`color`), when it does.
   *
   * Set as a custom property pair (`--plugin-declared-light`/`-dark`), not as a
   * colour, so the STYLE still decides whether it is used: `monochrome` leaves
   * the mark in the palette ink, and the declared brand colour only appears under
   * `[data-icon-style="color"]`. Two values because a brand hex is legible on one
   * variant and not the other; `legiblePair` derives both.
   */
  color?: string;
  size?: number;
  /** Filled background behind the fallback, for a card that wants a tile. */
  tile?: boolean;
}

export function PluginMark({ name, iconUrl, color, size = 16, tile = false }: PluginMarkProps) {
  // The mark's own colour, on the same wheel as every functional glyph. Set as a
  // custom property rather than a colour so the STYLE decides whether it is used:
  // monochrome leaves `--plugin-color` undefined and the mark keeps the ink.
  // A declared brand colour is clamped the way every other brand mark is
  // (`legiblePair`): a bright hex like `#34d399` is 1.9:1 on white paper, so the
  // light and dark values are derived instead of trusted.
  const declared = color ? legiblePair(color) : null;
  const hueValue = hashHue(name);
  const hue = {
    '--icon-hue': String(hueValue),
    // The LIGHT tone for that hue, from the same solved table the glyph rows
    // emit: a plugin's hue is runtime-only, so it cannot be a generated CSS row.
    '--icon-tone': iconTone(hueValue),
    ...(declared ? { '--plugin-declared-light': declared.light } : {}),
    ...(declared?.dark ? { '--plugin-declared-dark': declared.dark } : {}),
  } as Record<string, string>;
  if (iconUrl) {
    // The QUERY is stripped before the extension is read: the registry's URL is
    // `/api/panels/icon/<plugin>/<path>?v=<hash>`, so the extension is on the
    // path and never on the version. Anything not named `.svg` takes the
    // `<img>` — a mask of an unknown format either paints nothing or paints the
    // box solid, which is worse than a raster drawn in its own colours.
    if (/\.svg$/i.test(iconUrl.split('?')[0])) {
      return (
        <span
          aria-hidden="true"
          data-plugin-mark=""
          className="inline-block flex-shrink-0"
          style={{
            ...hue,
            width: size,
            height: size,
            // The ink the mask is cut out of — or the plugin's own colour, which
            // `[data-icon-style="color"]` supplies through `--plugin-color`.
            backgroundColor: 'var(--plugin-color, currentColor)',
            maskImage: `url("${iconUrl}")`,
            maskSize: 'contain',
            maskRepeat: 'no-repeat',
            maskPosition: 'center',
            // Safari still needs the prefix; Preact routes a hyphenated style
            // key through `setProperty`, which is the spelling it expects.
            '-webkit-mask-image': `url("${iconUrl}")`,
            '-webkit-mask-size': 'contain',
            '-webkit-mask-repeat': 'no-repeat',
            '-webkit-mask-position': 'center',
          }}
        />
      );
    }
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="flex-shrink-0 object-contain"
      />
    );
  }

  // The badge is a PILL, not a square, for the same reason the provider marks
  // are: `si.` is far wider than it is tall, so a square column would force a
  // font size whose ink is half its neighbours'. `aria-hidden` because the
  // plugin's name is always rendered beside it.
  return (
    <span
      aria-hidden="true"
      data-plugin-mark=""
      className={`inline-flex flex-shrink-0 items-center justify-center font-semibold lowercase leading-none ${
        tile ? 'rounded bg-ink/5' : ''
      }`}
      style={{
        ...hue,
        // 45% of the palette ink is what `text-ink/45` meant; stated as a value
        // so the colour mode can replace it without a second class.
        color: 'var(--plugin-color, color-mix(in srgb, var(--theme-ink) 45%, transparent))',
        height: size,
        minWidth: size,
        paddingInline: Math.max(1, Math.round(size * 0.12)),
        fontSize: Math.round(size * (tile ? 1.2 : 0.85)),
      }}
    >
      {providerInitials(name)}
    </span>
  );
}
