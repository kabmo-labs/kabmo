/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The gap under one workspace group in the phone's drawer.
 *
 * The gap belongs to the GROUP, so it shrinks when there is no group to
 * separate. Measured on a 390px phone: a folder header is 43px tall (its `+`
 * and `⋯` controls are 27px boxes inside 8px of padding, which is the touch
 * target), so the 16px that separates two EXPANDED groups put two CLOSED
 * folders 59px apart with 39px of blank ink between their names — twice the
 * list's own row rhythm (33px rows, 19px between titles). A closed folder is a
 * row, not a section, so it takes a row-sized gap; the group gap returns the
 * moment its sessions do.
 *
 * Stated here rather than inline in the component because it is the one thing
 * a mounted test cannot check: `happy-dom` resolves no layout, so a component
 * test can only read the class back, which the class string itself already
 * says. This module is the rule; the component applies it.
 */

/** Row-sized: the drawer's rows are separated by 2px, and the desktop list
 *  puts 4px between a header and the rows it owns. */
export const FOLDER_GAP_COLLAPSED = 'mb-1';

/** Group-sized: what separates one workspace's list from the next. */
export const FOLDER_GAP_EXPANDED = 'mb-4';

/**
 * `listOpen` is the same flag the component uses to draw the rows — the
 * EXPANDED state, or a batch selection that force-opens the group so its
 * checkboxes exist. A group whose rows are on screen is a section whatever the
 * user's own expansion flag says.
 */
export function folderGroupGap(listOpen: boolean): string {
  return listOpen ? FOLDER_GAP_EXPANDED : FOLDER_GAP_COLLAPSED;
}
