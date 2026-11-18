/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's row filters, as pure functions.
 *
 * Extracted from the controller so the controller stays a wiring module: the
 * search rule is the one with a subtle branch (the desktop force-expands a
 * match, the phone does not), and it is easier to read — and to test — beside
 * the harness rule than inside a 300-line hook.
 */

import type { WorkspaceFolderData } from '@/shared/types';

/**
 * Narrow the list to what the query names.
 *
 * A session matches on its title OR its id: the id is what "Copy session ID"
 * puts on the clipboard, and a search that could not find the string it just
 * handed the user would be a dead end.
 *
 * `expandMatches` is the desktop's rule — a folder whose NAME matched keeps all
 * its rows and opens, because the user asked for the workspace. The phone
 * filters without expanding and drops a folder that has nothing left to show.
 */
export function filterFoldersBySearch(
  folders: readonly WorkspaceFolderData[],
  query: string,
  expandMatches: boolean,
): WorkspaceFolderData[] {
  if (!query.trim()) return folders as WorkspaceFolderData[];
  const q = query.toLowerCase();
  const matchesSession = (session: { id: number | string; title: string }) =>
    session.title.toLowerCase().includes(q) || String(session.id).toLowerCase().includes(q);

  if (expandMatches) {
    return folders
      .filter((folder) => {
        const matchFolder = folder.name.toLowerCase().includes(q);
        const matchSession = folder.sessions?.some(matchesSession);
        return matchFolder || matchSession;
      })
      .map((folder) => {
        // If we are searching, we also filter the sessions within the folder
        const filteredSessions = folder.sessions?.filter((session) =>
          folder.name.toLowerCase().includes(q) || matchesSession(session)
        );
        return { ...folder, sessions: filteredSessions, isExpanded: true };
      });
  }

  return folders
    .map((folder) => {
      const matchesFolderName = folder.name.toLowerCase().includes(q);
      const filteredSessions = (folder.sessions || []).filter(matchesSession);
      if (matchesFolderName) return folder;
      return { ...folder, sessions: filteredSessions };
    })
    .filter((folder) => folder.sessions && folder.sessions.length > 0);
}
