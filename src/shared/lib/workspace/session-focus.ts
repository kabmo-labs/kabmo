/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar's focus filter: the list shows everything, or only the
 * chats that are doing something right now.
 *
 * It is a FILTER over the same folders, never a second query: the rows, their
 * actions, their archives and their worktrees are the ones the server already
 * sent. A workspace with nothing left to show is dropped entirely rather than
 * drawn as an empty header — the same rule the search filter follows, and the
 * reason a focus switch does not leave a column of empty workspaces.
 *
 * "Doing something" is deliberately three states and not one: a run in flight,
 * a prompt held behind another session, and an agent blocked on a question all
 * mean the user is waiting on this row. A finished run is not — `finish` is a
 * one-shot badge that clears when the session opens.
 */

import type { SessionItemData, WorkspaceFolderData } from '@/shared/types';

export type SessionFocus = 'all' | 'running';

export const SESSION_FOCUSES: readonly SessionFocus[] = ['all', 'running'];

export type SessionStatusLookup = (sessionId: string) => 'stream' | 'finish' | 'abort' | undefined;

/** True when this row is the reason the user opened the sidebar. */
export function isRunningSession(session: SessionItemData, status?: string): boolean {
  if (session.awaitingInput) return true;
  if (session.waitingFor) return true;
  return status === 'stream';
}

export interface FocusFilterInput {
  focus: SessionFocus;
  statusOf: SessionStatusLookup;
}

/**
 * The folders a focus filter offers. `all` returns the input untouched — the
 * caller compares by identity to know whether it has to expand anything.
 */
export function focusFolders(
  folders: readonly WorkspaceFolderData[],
  { focus, statusOf }: FocusFilterInput,
): WorkspaceFolderData[] {
  if (focus === 'all') return folders as WorkspaceFolderData[];
  return folders
    .map((folder) => ({
      ...folder,
      sessions: folder.sessions.filter((session) => isRunningSession(session, statusOf(String(session.id)))),
    }))
    .filter((folder) => folder.sessions.length > 0);
}

/** How many rows the focus filter would keep — the chip's badge. */
export function runningSessionCount(
  folders: readonly WorkspaceFolderData[],
  statusOf: SessionStatusLookup,
): number {
  let count = 0;
  for (const folder of folders) {
    for (const session of folder.sessions) {
      if (isRunningSession(session, statusOf(String(session.id)))) count += 1;
    }
  }
  return count;
}
