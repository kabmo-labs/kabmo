/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How a DESKTOP panel column is navigated: a vertical rail, or a browser-style
 * tab strip.
 *
 * One PRESENTATION choice over one catalog. Both styles draw the same views,
 * the same bodies and the same header; only the way a view is CHOSEN changes:
 *
 *  - `rail` — the 44px vertical activity bar. Every view is a button, all of
 *    them visible at once, and the source of the order is the column's own
 *    store (`omp_left_panels` on the left, `omp_right_panel_order` on the
 *    right). This is what Kabmo shipped and what a stored document still gets.
 *  - `tabs` — a 38px strip of chips at the top of the column, one per OPENED
 *    view, plus a home page that draws the whole catalog as a card grid. A view
 *    is opened from a card, closed from its chip, and never opened twice: the
 *    tab key is the panel id, so a second click focuses the existing tab.
 *
 * **Two settings, not one.** The left and right columns answer different
 * questions — the left is the session list plus whatever the user placed there,
 * the right is a working set the user opens and closes all day — so a user who
 * wants tabs on the right and the rail on the left must be able to say so. The
 * values are independent; `PanelNavSide` is what keys each one.
 *
 * **Desktop only.** The phone has one drawer per side, and its chip strip is
 * already the browser-style answer at touch size. `mobile/**` never reads this
 * module: a phone that took the `rail` value would draw a 44px rail into a
 * drawer, and one that took `tabs` would draw a second chip strip beside the one
 * it already has.
 *
 * Dependency-free on purpose: the settings type imports `PanelNavStyle` from
 * here, so an import back the other way would be a cycle. The live-apply hook
 * lives in `client/hooks/workspace/panel-nav.ts`, exactly as the sidebar style
 * splits them.
 */

/** Which desktop columns have their own navigation setting. */
export type PanelNavSide = 'left' | 'right';

/** How a column is navigated. */
export type PanelNavStyle = 'rail' | 'tabs';

/** Every style, in the order the settings control lists them. */
export const PANEL_NAV_STYLES = ['rail', 'tabs'] as const;

/**
 * The style a document with no stored preference renders at.
 *
 * `rail` and not `tabs`: the rail is what every existing install has on screen,
 * so an upgrade must rearrange nothing. A user who wants tabs opts in, per
 * column.
 */
export const DEFAULT_PANEL_NAV: PanelNavStyle = 'rail';

/** A stored value written by another build is not a style this one can draw. */
export function isPanelNavStyle(value: unknown): value is PanelNavStyle {
  return value === 'rail' || value === 'tabs';
}

/**
 * The style to APPLY for a stored value. Anything this build cannot draw — a
 * value from a newer build, a corrupted blob, `undefined` on a fresh install —
 * resolves to the default rather than to a renderer that does not exist.
 */
export function resolvePanelNav(value: unknown): PanelNavStyle {
  return isPanelNavStyle(value) ? value : DEFAULT_PANEL_NAV;
}

/** Whether `value` names a column this build has a setting for. */
export function isPanelNavSide(value: unknown): value is PanelNavSide {
  return value === 'left' || value === 'right';
}

export interface PanelNavCopy {
  /** Card title. */
  label: string;
  /** One line under the title. */
  description: string;
  /** What the card's miniature is captioned. */
  caption: string;
}

export const PANEL_NAV_COPY: Record<PanelNavStyle, PanelNavCopy> = {
  rail: {
    label: 'Rail',
    description:
      'A vertical bar of panel buttons. Every view is one click away and the bar never changes width.',
    caption: '44px rail · all views',
  },
  tabs: {
    label: 'Tabs',
    description:
      'A browser-style strip along the top of the column. Views open from a home page and close from their tab.',
    caption: 'Tab strip · home page',
  },
};

/** The `app_settings` key each column's choice is stored under. */
export const PANEL_NAV_SETTING_KEYS: Record<PanelNavSide, 'leftPanelNav' | 'rightPanelNav'> = {
  left: 'leftPanelNav',
  right: 'rightPanelNav',
};

/**
 * How the PHONE's right drawer navigates its panel views.
 *
 * A separate axis from the desktop columns because a phone has no rail: there
 * is nowhere to put a 44px strip of marks beside a drawer that already IS the
 * screen. The two answers are therefore about the DRAWER's own chrome:
 *
 *  - `classic` — the chip strip the drawer ships today: every view is a chip
 *    and tapping one swaps the body. It has no memory of what is open, so the
 *    strip is the whole catalog every time.
 *  - `tabs` — the desktop's working set on a phone: the strip holds only the
 *    views the user opened, a home page draws the catalog as cards, and the
 *    drawer reopens on what was open rather than on the whole list.
 *
 * **`classic` is the default**, like the desktop's `rail`: an upgrade
 * rearranges nothing, and a user who wants the drawer to behave like the
 * desktop column opts in.
 */
export type MobileRightPanelNav = 'classic' | 'tabs';

/** Every mobile style, in the order the settings control lists them. */
export const MOBILE_RIGHT_PANEL_NAVS = ['classic', 'tabs'] as const;

export const DEFAULT_MOBILE_RIGHT_PANEL_NAV: MobileRightPanelNav = 'classic';

export function isMobileRightPanelNav(value: unknown): value is MobileRightPanelNav {
  return value === 'classic' || value === 'tabs';
}

/** A stored value this build cannot draw resolves to the default. */
export function resolveMobileRightPanelNav(value: unknown): MobileRightPanelNav {
  return isMobileRightPanelNav(value) ? value : DEFAULT_MOBILE_RIGHT_PANEL_NAV;
}

/**
 * The `app_settings` key the phone's choice lives under.
 *
 * `satisfies keyof SettingsState` at the reader, like every other key module:
 * the key and the field name must be the same string or the setting silently
 * never persists.
 */
export const MOBILE_RIGHT_PANEL_NAV_KEY = 'mobileRightPanelNav' as const;
