/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The drag payload that says "this is a PANEL button, not a file or a URL".
 *
 * A rail — or the left column's body — must only accept a panel from a rail.
 * Accepting arbitrary text would turn a dropped URL into a `setPanelSide` call
 * the store then refuses, which is a drop that appears to do nothing.
 *
 * The type rides on `dataTransfer`, so a destination can test it during
 * `dragover` (where `getData` is empty by design) and read the id only on
 * `drop`. These two reads are the whole protocol, shared by both rails and the
 * column, which is why they live here rather than in each surface.
 */
export const PANEL_DRAG_MIME = 'application/x-kabmo-panel';

/** Whether a drag was started by a panel button. */
export function carriesPanelDrag(types: readonly string[] | undefined): boolean {
  return Array.isArray(types) && types.includes(PANEL_DRAG_MIME);
}

/**
 * The dragged panel's id, readable on `drop`.
 *
 * `text/plain` is the fallback because the button writes both: a drag that left
 * the app and came back may carry only the plain-text shape.
 */
export function droppedPanelId(transfer: { getData: (type: string) => string } | null): string | null {
  if (!transfer) return null;
  return transfer.getData(PANEL_DRAG_MIME) || transfer.getData('text/plain') || null;
}
