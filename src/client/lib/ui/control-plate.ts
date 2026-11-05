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
