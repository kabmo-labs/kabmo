/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bringing one child of a horizontal scroll strip into view.
 *
 * A strip whose selection can be set from OUTSIDE itself — the phone's panel
 * chips are picked by a plugin's navbar readout as well as by a tap — renders
 * the chosen view while its own tab sits past the strip's right edge, and with
 * the scrollbar hidden (`no-scrollbar`) nothing on screen says so. The drawer
 * then reads as having opened the wrong view.
 *
 * The rule is deliberately the minimum movement that makes the child visible:
 * a child already in view leaves the scroll offset alone, so a reveal running
 * on every render (or on every resize) never fights a reader who scrolled the
 * strip themselves.
 */

export interface RevealGeometry {
  /** The container's current scroll offset along the strip. */
  scrollLeft: number;
  /** The container's visible width. */
  clientWidth: number;
  /** The container's scrollable content width. */
  scrollWidth: number;
  /** The child's offset from the container's content start. */
  start: number;
  /** The child's own size along the strip. */
  size: number;
}

/**
 * The scroll offset that reveals the child, clamped to the strip's own range.
 *
 * A child WIDER than the viewport cannot be fully revealed; its LEADING edge
 * wins, because a chip's label follows its mark and a reader who sees the end
 * of a chip knows less than one who sees its start.
 */
export function scrollLeftForReveal(geometry: RevealGeometry, pad = 0): number {
  const { scrollLeft, clientWidth, scrollWidth, start, size } = geometry;
  const max = Math.max(0, scrollWidth - clientWidth);
  const leading = start - pad;
  const trailing = start + size + pad;
  // A child that cannot fit shows its LEADING edge: a chip's label follows its
  // mark, so the start is the half that names it, and satisfying the trailing
  // edge would hide exactly that.
  if (size + pad * 2 >= clientWidth) return Math.max(0, Math.min(max, leading));
  let next = scrollLeft;
  if (leading < scrollLeft) next = leading;
  else if (trailing > scrollLeft + clientWidth) next = trailing - clientWidth;
  return Math.max(0, Math.min(max, next));
}
