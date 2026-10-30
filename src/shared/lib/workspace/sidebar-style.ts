/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which chrome the session sidebar draws, as ONE of two styles.
 *
 * This is a PRESENTATION choice over a single data source, not a second
 * sidebar: both styles render the same folders, the same rows, the same
 * actions and the same dialogs, because the data, the controller and every
 * mutation live in the view that owns them (`SessionsView`). A style only picks
 * the frame — a control that exists in one style and not the other is a bug,
 * which is why the shared row and the shared workspace section are primitives
 * rather than two copies.
 *
 *  - `classic` — the toolbar of boxed icons and the 24px rows Kabmo has always
 *    shipped. It is the DEFAULT, deliberately: an upgrade must not rearrange a
 *    sidebar the user did not ask to change (the same rule
 *    `DEFAULT_TOOL_RENDER_MODE` follows).
 *  - `modern`  — a permanent search field, filter chips, sticky workspace
 *    headers and a taller row whose trailing column is shared by the age and
 *    the actions trigger.
 *
 * **The names and the copy live here**; the markup lives in
 * `layout/session-sidebar/modern/`. A style added here without a renderer is a
 * build error at the switch in `SessionsView`, not a silent fallback.
 *
 * Global, not per-session, and ONE value for desktop and phone: the shape of a
 * list is a property of the person and the display, not of one conversation,
 * and two knobs would be two axes to drift along.
 *
 * This module is deliberately dependency-free: it is imported by
 * `shared/types/settings/state.ts` (for the `SidebarStyle` field type), so a
 * type import back the other way would be a cycle. The `app_settings` key
 * lives with its live-apply hook (`client/hooks/workspace/sidebar-style.ts`),
 * exactly as the tool-render style splits them.
 */

export type SidebarStyle = 'classic' | 'modern';


/**
 * The style a document with no stored preference renders at — the one Kabmo
 * shipped before the setting existed, so an upgrade changes nothing.
 */
export const DEFAULT_SIDEBAR_STYLE: SidebarStyle = 'classic';

/** Every style, in the order the settings control lists them. */
export const SIDEBAR_STYLES = ['classic', 'modern'] as const;

/** A stored value written by another build is not a style this one can draw. */
export function isSidebarStyle(value: unknown): value is SidebarStyle {
  return value === 'classic' || value === 'modern';
}

/**
 * The style to APPLY for a stored value. Anything this build cannot draw — a
 * value from a newer build, a corrupted blob, `undefined` on a fresh install —
 * resolves to the default rather than to a renderer that does not exist.
 */
export function resolveSidebarStyle(value: unknown): SidebarStyle {
  return isSidebarStyle(value) ? value : DEFAULT_SIDEBAR_STYLE;
}

export interface SidebarStyleCopy {
  /** Card title. */
  label: string;
  /** One line under the title. */
  description: string;
  /** What the card's miniature is labelled, so the drawing is not the only cue. */
  caption: string;
}

export const SIDEBAR_STYLE_COPY: Record<SidebarStyle, SidebarStyleCopy> = {
  classic: {
    label: 'Classic',
    description: 'A toolbar of boxed icons and compact rows — the layout Kabmo has always shipped.',
    caption: 'Toolbar · 24px rows',
  },
  modern: {
    label: 'Modern',
    description: 'Permanent search, filter chips, sticky workspace headers and taller rows with one trailing column.',
    caption: 'Search · chips · 30px rows',
  },
};
