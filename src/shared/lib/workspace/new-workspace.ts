/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The window event that asks a layout to open the New Workspace dialog.
 *
 * The composer's workspace picker offers "Add new workspace", but the dialog is
 * owned by the LAYOUT, not by the picker: the desktop sidebar that used to own
 * it is unmounted while the dock shows a plugin panel, and the phone's drawer is
 * a screen the chat can be shown without. The picker therefore asks; whichever
 * layout is mounted answers.
 */
export const NEW_WORKSPACE_EVENT = 'omp:new-workspace';

/** Ask the mounted layout to open the New Workspace dialog. */
export function requestNewWorkspace(): void {
  window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT));
}
