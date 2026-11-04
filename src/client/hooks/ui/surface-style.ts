/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The single writer for the app's surface style.
 *
 * The style is an ATTRIBUTE on `<html>`, and CSS is its only consumer: the
 * frosted plane, the translucent panel tints and the rim/shadow tokens all live
 * in `src/client/tailwind.css`, keyed by `[data-surface]`. That is why this
 * module exports no hook — nothing in the shell reads the value in JavaScript,
 * and a hook would exist only to re-render subtrees CSS already repaints.
 *
 * The attribute is written at boot (`initSurfaceStyle`, before the first
 * render) so a glass document never paints one opaque frame first, and on every
 * change from the settings modal (`applySurfaceStyle`).
 *
 * There is deliberately no document observer, unlike `theme.ts`: the theme has
 * runtime consumers that cannot read CSS (the mermaid hydrator repaints
 * diagrams per palette), so it needs an event. A surface material has none.
 */

import { readKabmoSetting } from '@/shared/lib/settings/client';
import {
  DEFAULT_SURFACE_STYLE,
  SURFACE_ATTRIBUTE,
  SURFACE_STYLE_SETTING_KEY,
  resolveSurfaceStyle,
} from '@/shared/lib/theme/surface-style';

/**
 * Point the document at `style`.
 *
 * The default is REMOVED rather than written, so a document carrying `classic`
 * and a document carrying nothing are the same state — which is what makes the
 * `:root` fallback in CSS the single statement of the opaque default.
 */
export function applySurfaceStyle(style: unknown): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveSurfaceStyle(style);
  if (resolved === DEFAULT_SURFACE_STYLE) root.removeAttribute(SURFACE_ATTRIBUTE);
  else root.setAttribute(SURFACE_ATTRIBUTE, resolved);
}

/**
 * Apply the stored style before the first render.
 *
 * Called from `main.tsx` right after `primeKabmoSettings`, because the boot
 * payload is what `readKabmoSetting` answers from. Without it a glass install
 * would paint the opaque shell for one frame and then swap it.
 */
export function initSurfaceStyle(): void {
  applySurfaceStyle(readKabmoSetting<unknown>(SURFACE_STYLE_SETTING_KEY));
}
