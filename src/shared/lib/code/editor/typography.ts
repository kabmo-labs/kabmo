/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's typography, in one place.
 *
 * The desktop editor and the phone's full-screen editor are the same surface on
 * two layouts, so their text has to be the same text — the same face and the
 * same line box. It was not: the stack was written out as a literal twice in
 * the desktop editor and replaced by a bare `monospace` on the phone, which
 * dropped Fira Code (and the ligatures the whole console is typeset in) and put
 * the phone's line numbers in a different face from the code beside them — the
 * gutter was already `font-mono`.
 *
 * `EDITOR_LINE_HEIGHT` is a ratio rather than a pixel value for the reason the
 * desktop editor already used one: the zoom control changes the font size, and
 * a fixed pixel line box keeps the rows at the size they were chosen for at
 * 12px — cramped at 18px, loose at 10px. It has to be applied to the gutter as
 * well as the editor, because with word wrap off the gutter rows carry no
 * explicit height and take their spacing from their own line-height; a gutter
 * pinned to a different value drifts out of register with the lines it counts.
 *
 * The two layouts keep their own padding and gutter width — a phone has less
 * room, and the padding is chrome, not type. Everything that decides how a
 * glyph is drawn lives here.
 */

/** Fira Code first (bundled — see `fira-code-fonts.css`), then faces a system may already have. */
export const EDITOR_FONT_FAMILY = '"Fira Code", "JetBrains Mono", "SF Mono", Consolas, monospace';

/**
 * The faces the editor font picker offers, in the order it lists them.
 *
 * Each entry is a CSS family name. The editor puts the chosen one FIRST in its
 * stack and keeps the rest of `EDITOR_FONT_FAMILY` behind it, so a face the
 * device does not have falls through to the bundled Fira Code rather than
 * rendering a blank or a system serif — which is what makes this setting safe
 * to offer without shipping every font in the list. Only Fira Code is bundled;
 * the others are names a system may or may not have, and the picker says so.
 *
 * `id` is the stored value and is deliberately the CSS name itself: a mapping
 * table would add a second thing to keep in sync, and the name is already the
 * only thing the renderer needs.
 */
export const EDITOR_FONT_CHOICES = [
  { id: 'Fira Code', label: 'Fira Code', bundled: true },
  { id: 'JetBrains Mono', label: 'JetBrains Mono', bundled: false },
  { id: 'SF Mono', label: 'SF Mono', bundled: false },
  { id: 'Menlo', label: 'Menlo', bundled: false },
  { id: 'Consolas', label: 'Consolas', bundled: false },
  { id: 'Monaco', label: 'Monaco', bundled: false },
  { id: 'Courier New', label: 'Courier New', bundled: false },
] as const;

/** The stored setting's default; also the first entry the picker lists. */
export const EDITOR_DEFAULT_FONT_FAMILY = 'Fira Code';

/**
 * The editor's font stack with `family` preferred.
 *
 * The chosen face is quoted (the list carries multi-word names) and placed
 * ahead of the shared stack, so an unknown or uninstalled name degrades to the
 * bundled Fira Code instead of replacing it. An empty or absent choice yields
 * the shared stack unchanged, which is what a settings row that predates this
 * option holds.
 */
export function editorFontStack(family?: string | null): string {
  const chosen = (family ?? '').trim();
  if (!chosen || chosen === EDITOR_DEFAULT_FONT_FAMILY) return EDITOR_FONT_FAMILY;
  return `"${chosen}", ${EDITOR_FONT_FAMILY}`;
}

/** Line box as a multiple of the font size; apply to the editor AND its gutter. */
export const EDITOR_LINE_HEIGHT = 1.5;

/** Font size in px both editors open at. */
export const EDITOR_DEFAULT_FONT_SIZE = 12;

/**
 * Zoom bounds, in px. Shared so the two layouts offer the same range — a phone
 * clamped to a narrower one is a different editor, not a smaller one.
 */
export const EDITOR_MIN_FONT_SIZE = 8;
export const EDITOR_MAX_FONT_SIZE = 24;
