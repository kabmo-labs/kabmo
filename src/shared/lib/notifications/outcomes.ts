/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The run outcomes a sidebar-status snapshot is worth a notification for.
 *
 * Only `stream → finish` is news. `abort` is not: the operator either stopped
 * the run themselves or a heal pass settled a process that had already gone
 * away, and neither is an event to raise a banner for. A `finish` badge that is
 * ALREADY there when the page loads is not news either — it is the state of the
 * world the page woke up to, which is why the caller compares against the
 * previous snapshot rather than notifying on presence.
 *
 * A failed run is the same transition with `runFailure` set, so the two
 * notifications share one rule and cannot disagree about when they fire.
 */

import type { WorkspaceFolderData } from '@/shared/types';

export type StreamOutcome = 'stream' | 'finish' | 'abort' | undefined;

export interface RunOutcomeNotice {
  kind: 'finish' | 'error';
  /** The session the message is about; also the notification's tag. */
  sessionId: string;
  title: string;
  detail: string;
}

/** The status map one folder snapshot carries, for the next comparison. */
export function streamOutcomes(folders: WorkspaceFolderData[]): Map<string, StreamOutcome> {
  const outcomes = new Map<string, StreamOutcome>();
  for (const folder of folders) {
    for (const session of folder.sessions ?? []) {
      outcomes.set(String(session.id), session.streamStatus);
    }
  }
  return outcomes;
}

/** The notices `folders` earns against `previous`. */
export function runOutcomeNotices(
  previous: ReadonlyMap<string, StreamOutcome>,
  folders: WorkspaceFolderData[],
): RunOutcomeNotice[] {
  const notices: RunOutcomeNotice[] = [];
  for (const folder of folders) {
    for (const session of folder.sessions ?? []) {
      const sessionId = String(session.id);
      if (session.streamStatus !== 'finish') continue;
      if (previous.get(sessionId) !== 'stream') continue;
      const failure = typeof session.runFailure === 'string' ? session.runFailure.trim() : '';
      notices.push({
        kind: failure ? 'error' : 'finish',
        sessionId,
        title: session.title?.trim() || 'Kabmo',
        detail: failure || 'The run finished.',
      });
    }
  }
  return notices;
}
