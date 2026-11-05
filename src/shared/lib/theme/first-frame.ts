/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The colour the browser paints before the bundle's stylesheet lands.
 *
 * Two problems, one value:
 *
 * - **The first frame.** The UA's canvas is white, and on a dark install that is
 *   a measured white flash for the length of the CSS request. The palette's
 *   ground is the only correct answer, and it has to be inline because nothing
 *   else has loaded.
 * - **The frame must follow the theme AT RUNTIME.** This rule is unlayered, so
 *   it outranks the `body` rule in `tailwind.css` at any specificity — which is
 *   exactly what makes it work before the bundle and exactly what made it wrong
 *   after a theme switch: measured, choosing a light theme at runtime left
 *   `body` painted `rgb(30,34,42)` from the previous dark palette while
 *   `--theme-canvas` had already moved. The element carries a stable id so
 *   `applyDocumentTheme` can rewrite it in the same write that flips the
 *   palette; a second copy of the colour is a second thing to forget.
 *
 * Shared rather than server-only for that second reason: the shell writes the
 * first value and the client rewrites every later one, from this one function.
 */

import type { ThemePalette } from '@/shared/types/theme';
import { parseHexColor, rgbaToHex } from '@/shared/lib/theme/color';

/** The `<style>` element's id: the SSR shell writes it, the theme writer updates it. */
export const FIRST_FRAME_STYLE_ELEMENT_ID = 'omp-first-frame';

/** The inline rule that paints `html` and `body` before the bundle loads. */
export function firstFrameStyle(palette: ThemePalette): string {
  const canvas = rgbaToHex(parseHexColor(palette.canvas) ?? { r: 0, g: 0, b: 0, a: 1 });
  return `html,body{background-color:${canvas};}`;
}
