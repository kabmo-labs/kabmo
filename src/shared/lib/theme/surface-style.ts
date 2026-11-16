/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How the app's surfaces are painted, as ONE of two styles.
 *
 * This is a PRESENTATION choice over the same shell: both styles render the
 * same panels, rows, controls and dialogs. Nothing is hidden, moved or
 * re-ordered — only the material the surfaces are cut from changes, which is
 * why this module states names and copy while `src/client/tailwind.css` states
 * every pixel.
 *
 *  - `classic` — opaque paper over the palette's canvas. Rendered when the
 *    attribute is ABSENT, which is why `SURFACE_STYLE_WITHOUT_ATTRIBUTE` is
 *    `classic` and not the default: CSS states the opaque look once, in `:root`.
 *  - `glass`   — one frosted plane over a palette-coloured aura, with the
 *    panels above it as translucent tints. The plane owns the blur (a single
 *    `backdrop-filter` per window), so the panel count does not decide the
 *    frame budget. The DEFAULT a fresh install resolves to.
 *
 * The style reaches the document as `data-surface` on `<html>`, never as a
 * prop: the sidebar, the navbar, the composer and every modal are separate
 * subtrees, and a prop would be one call site each — the exact shape that lets
 * one surface stay classic while the rest turn to glass.
 *
 * A style added here without a CSS rule renders EXACTLY like `classic`, and the
 * settings card is the only place that can notice. There is deliberately no
 * error for that: an attribute with no matching rule is a valid document.
 */

export type SurfaceStyle = 'classic' | 'glass';

/**
 * The style a fresh install — or any stored value this build cannot draw —
 * resolves to.
 */
export const DEFAULT_SURFACE_STYLE: SurfaceStyle = 'glass';

/**
 * The style CSS paints when `data-surface` is absent.
 *
 * Two facts, kept apart on purpose: the DEFAULT is what a fresh install picks,
 * while the ABSENT state is what `:root` in `tailwind.css` paints. They
 * coincide only before the default moved to `glass`; every writer must compare
 * against THIS constant when deciding whether the attribute can be omitted.
 */
export const SURFACE_STYLE_WITHOUT_ATTRIBUTE: SurfaceStyle = 'classic';

/** Document attribute carrying the style. Read by CSS only. */
export const SURFACE_ATTRIBUTE = 'data-surface';

/**
 * `app_settings` key holding the style, in the `kabmo_settings` blob.
 *
 * It lives HERE, beside the type and the copy, because two processes read it:
 * the browser (`client/hooks/ui/surface-style.ts`) and the SSR shell that has to
 * paint the first frame (`server/lib/assets/shell-attributes.server.ts`). A key
 * spelled at both ends is a setting that saves and never loads.
 */
export const SURFACE_STYLE_SETTING_KEY = 'surfaceStyle';

/** Every style, in the order the settings control lists them. */
export const SURFACE_STYLES = ['classic', 'glass'] as const;

/** A stored value written by another build is not a style this one can draw. */
export function isSurfaceStyle(value: unknown): value is SurfaceStyle {
  return value === 'classic' || value === 'glass';
}

/**
 * The style to APPLY for a stored value. Anything this build cannot draw — a
 * value from a newer build, a corrupted blob, `undefined` on a fresh install —
 * resolves to the default rather than to a rule that does not exist.
 */
export function resolveSurfaceStyle(value: unknown): SurfaceStyle {
  return isSurfaceStyle(value) ? value : DEFAULT_SURFACE_STYLE;
}

export interface SurfaceStyleCopy {
  /** Card title. */
  label: string;
  /** One line under the title: the tradeoff, not the aesthetic. */
  description: string;
  /** The card's miniature caption, so the drawing is not the only cue. */
  caption: string;
}

export const SURFACE_STYLE_COPY: Record<SurfaceStyle, SurfaceStyleCopy> = {
  classic: {
    label: 'Classic',
    description: 'Opaque panels on the palette canvas. The sharpest text, the cheapest frame, and what an upgrade keeps.',
    caption: 'Opaque · no blur',
  },
  glass: {
    label: 'Glass',
    description: 'One frosted plane under a palette-tinted glow, with translucent panels above it. Softer edges, one blur pass per window.',
    caption: 'Frosted · 1 blur pass',
  },
};
