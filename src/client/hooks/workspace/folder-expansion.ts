/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The folder expand/collapse write, for every caller that is not the desktop
 * category header.
 *
 * `workspace_folders.is_expanded` is the one stored fact both layouts render,
 * and the route republishes the `sidebar` structure topic on the write, so a
 * caller only has to issue the request — it never has to update local state.
 *
 * The desktop header keeps its own `useFetcher` submit (it re-dispatches on the
 * response); that difference is documented in `workspace-folder-actions.ts`.
 * The phone's toggle and the controller's auto-expand both come through here so
 * the URL and body cannot drift.
 */
export async function setFolderExpanded(
  folderId: number | string,
  isExpanded: boolean,
): Promise<boolean> {
  try {
    const response = await fetch(`/api/folders/${encodeURIComponent(String(folderId))}/toggle`, {
      method: 'POST',
      body: new URLSearchParams({ isExpanded: String(isExpanded) }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to save workspace expansion:', error);
    return false;
  }
}
