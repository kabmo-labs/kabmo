/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The measurements a branch row borrows from the chrome's session row.
 *
 * A subagent row is a leaf of the same tree, so it has to keep the session
 * row's inset, vertical rhythm and mark size — otherwise the robot sits a few
 * pixels off the harness beside it. The tree lines need one more number: where
 * the row's leading slot CENTRE sits, because that is the column a guide line
 * must run under. The chrome that owns the row component exports its own
 * instance of this.
 */
export interface BranchRowStyle {
  /** Horizontal padding of the chrome's session row (`px-2`, `pl-1 pr-1`, …). */
  inset: string;
  /** The same padding in px, for the guide geometry. */
  insetPx: number;
  /** Width of the row's leading slot: 16px, 18px on the modern touch row. */
  slotWidth: number;
  /** Gap between the leading slot and the harness/robot mark (the row's `w-2`). */
  markGap: number;
  /** Vertical padding of the chrome's session row, so heights match. */
  padding: string;
  /** Harness/robot mark width, in px. */
  glyph: number;
}
