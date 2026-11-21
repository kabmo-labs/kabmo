/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The box around an icon-only control, and the space between controls in one
 * chrome row.
 *
 * These numbers are a DENSITY fact, and the row they have to agree with is the
 * session sidebar's action row (`layout/session-sidebar/modern/ActionRow.tsx`):
 * a 28px box at `gap-0.5` on the desktop, a 36px box at `gap-0.5` on a phone.
 * The navbar used to state its own — `p-1.5` with `space-x-1` (4px) on the
 * desktop, and a `.tap-target` 44px plate with 4px on the phone. Measured on
 * the running app, the phone row's glyph pitch was 48px against the drawer
 * row's 38px, which is the "controls floating apart" the header read as. The
 * box is the bigger half of that: 44px around an 18px glyph is 13px of empty on
 * each side before the gap is counted at all.
 *
 * Two things this module does NOT own:
 *
 * - **Colour, radius and hover state.** Each control states its own, because a
 *   plugin-backed readout, a toggle and a destructive control do not share one.
 * - **The 44px touch floor** (`.tap-target` in `tailwind.css`). It still applies
 *   to controls that stand ALONE — the composer's attach/maximise, the session
 *   picker chip. It does not apply inside a dense chrome row: a 44px box in a
 *   36px-density row IS the airiness being fixed, and overlapping hit areas to
 *   buy the floor back steal a neighbour's click (the measured reason the floor
 *   is real geometry rather than a pseudo-element).
 */

export type ControlLayout = 'desktop' | 'mobile';

/**
 * The box the hover tint paints and the glyph is centred in. The glyph is
 * `CONTROL_GLYPH_PX[layout]`, so the two together are what make the pitch:
 * 28 + 2 = 30px on a desktop, 36 + 2 = 38px on a phone.
 */
export const CONTROL_BOX: Record<ControlLayout, string> = {
  desktop: 'w-7 h-7 inline-flex items-center justify-center',
  mobile: 'w-9 h-9 inline-flex items-center justify-center',
};

/**
 * Between two controls in one row — 2px, the sidebar action row's `gap-0.5`.
 * Written as a `gap-*` because `space-x-*` puts the same margin on both sides
 * of every child and doubles itself against a neighbouring cluster.
 */
export const CONTROL_ROW_GAP = 'gap-0.5';

/**
 * Between two CLUSTERS of controls in one row — 4px, the sidebar action row's
 * own outer `gap-1`. A row holds clusters, not only controls: a labelled chip
 * beside a group of icon buttons is two things, and 2px would read as though it
 * belonged to the group.
 */
export const CONTROL_CLUSTER_GAP = 'gap-1';

/**
 * The glyph the navbar centres in that box: 16px in the 28px box, 18px in the
 * 36px one. The sidebar's action row centres a 14px glyph in the same boxes —
 * a list row's icons read at list density — so the BOX and the gap are what the
 * two surfaces share, not the glyph.
 */
export const CONTROL_GLYPH_PX: Record<ControlLayout, number> = { desktop: 16, mobile: 18 };

/**
 * The activity rail's width in px — `ActivityBar`'s `w-11`.
 *
 * The top navbar spans the same right edge as the rail, so its last control is
 * centred on the rail's axis by insetting it by half the difference. The two
 * numbers are one alignment fact and are stated together here; the navbar used
 * to carry a flat `1rem`, which put the right-panel toggle's centre 8px to the
 * left of every rail mark.
 */
export const ACTIVITY_BAR_WIDTH_PX = 44;

/** The control box's width in px — the `w-7`/`w-9` in `CONTROL_BOX`. */
export const CONTROL_BOX_PX: Record<ControlLayout, number> = { desktop: 28, mobile: 36 };

/**
 * The height of a chrome row, per layout — the TOP NAVBAR's own row.
 *
 * A panel column's tab strip is that navbar's PEER, not a second band beside
 * it: on the desktop it sits under the navbar at `h-10`, and on the phone the
 * strip IS the title bar, so it takes the header's 56px plus the notch. Stating
 * both here is what stops the strip inventing a third height — it has been 38px,
 * then 40px on a phone whose own header was 56px, which is exactly the "not
 * aligned with the top navbar" that a reader sees as a broken edge.
 *
 * The notch is height AND padding on the phone, because `box-sizing` is
 * border-box globally: height alone leaves the content pinned to y=0 (chips
 * under the status bar), padding alone collapses the content box.
 */
export const CONTROL_ROW_HEIGHT: Record<ControlLayout, string> = {
  desktop: 'h-10',
  mobile: 'h-[calc(3.5rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)]',
};

/**
 * The horizontal inset of that row.
 *
 * A phone header is `px-3` and its controls are 36px boxes, so the outermost
 * control's centre is 30px from the edge. A strip that insets 6px instead puts
 * its own control's centre at 26px — the 4px misalignment measured between the
 * chat header's hamburger and the drawer's add control. The desktop columns are
 * interior edges with no shared alignment target, so they keep the dense 6px.
 */
export const CONTROL_ROW_INSET: Record<ControlLayout, string> = {
  desktop: 'px-1.5',
  mobile: 'px-3',
};

/**
 * The right padding that centres a `lastControlPx`-wide control on the activity
 * rail below it: `(rail - control) / 2`.
 *
 * A control as wide as the rail needs no inset; the Windows/Linux caption
 * cluster is exactly that, which is why the caller passes the width of whatever
 * control actually ends the row rather than assuming the icon box.
 */
export function railAlignedInset(lastControlPx: number): string {
  return `${(ACTIVITY_BAR_WIDTH_PX - lastControlPx) / 2}px`;
}

/**
 * The navbar's two edge insets, before the titlebar's own insets are applied.
 *
 * The right edge is always the activity rail's, so the last control is centred
 * on it. The left edge is the rail's only while the sidebar is collapsed: an
 * open sidebar puts the navbar's left edge at the sidebar's right edge, where
 * the title takes the ordinary `1rem` inset and the sidebar's own header
 * carries the window's left inset.
 */
export function navbarEdgeInsets(showLeftPanel: boolean, lastControlPx: number): { left: string; right: string } {
  return {
    left: showLeftPanel ? '1rem' : railAlignedInset(CONTROL_BOX_PX.desktop),
    right: railAlignedInset(lastControlPx),
  };
}
