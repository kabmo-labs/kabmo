/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's two CLIENT-side overlays, and nothing else.
 *
 * Neither of them is a run state. `stream` comes from the server's
 * `session_stream_state` row alone (`sidebar:status` topic) — see
 * `session-statuses.ts` for why a client-side mark was removed.
 *
 *   - the SEEN strip: a one-shot terminal badge (`finish`/`abort`) this mount
 *     already acknowledged, hidden until the list refetches without it. It can
 *     only ever REMOVE a status, never invent one.
 *   - the TITLE hint: the text the user just sent, shown by the placeholder row
 *     until omp's transcript scan can name the session (omp writes its file only
 *     when the first assistant message settles, measured ~17s).
 */

import type { WorkspaceFolderData } from '@/shared/types';
import { publishClientSignal } from '@/client/lib/signals';

/** The title-hint signal name, for a consumer that subscribes. */
export const SESSION_TITLE_HINT_SIGNAL = 'session-title-hint' as const;

export interface SessionTitleHintDetail {
  sessionId: string;
  title: string;
}

/**
 * Seed a session's sidebar row with the text the user just sent.
 *
 * The row's real title comes from omp's transcript scan, and for a new session
 * that scan cannot see it yet: omp creates the session file only when the first
 * assistant message settles (measured ~17s on a plain prompt, because its
 * writes are buffered). Until then the sidebar's placeholder row is the only
 * thing on screen, and it used to say `New Session - <timestamp>` for the whole
 * first run — the operator's own words, which the client already has at send
 * time, name the row far better than a clock.
 *
 * A hint, not a rename: the placeholder stops using it the moment omp's row
 * exists, so nothing here can overwrite the title omp derived.
 */
export function setSessionTitleHint(sessionId: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  publishClientSignal(SESSION_TITLE_HINT_SIGNAL, { sessionId, title: trimmed });
}

/**
 * Hide a terminal badge this mount already acked, so the check renders exactly
 * once and disappears with the click instead of waiting for the refetch.
 *
 * A live `stream` row is never stripped: it is a run in flight, and the click's
 * optimistic strip exists only for the one-shot badge. Applied BEFORE anything
 * reads the list, so the ack effect cannot double-POST against a stale map.
 */
export function applySeenStrip(
  folders: WorkspaceFolderData[],
  seen: Set<string>,
): WorkspaceFolderData[] {
  if (seen.size === 0) return folders;
  return folders.map((folder) => ({
    ...folder,
    sessions: (folder.sessions ?? []).map((session) => {
      const key = String(session.id);
      if (!seen.has(key) || !session.streamStatus || session.streamStatus === 'stream') return session;
      return { ...session, streamStatus: undefined };
    }),
  }));
}
