/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * App-wide "a run ended" cue.
 *
 * It reads the shared session list rather than the open timeline for the same
 * reason `useInputRequiredAlert` does: the run that mattered is usually NOT the
 * session on screen. The status topic is written by the server on every
 * terminal settle, so this reaches a background session this tab never opened.
 *
 * Only a transition earns a banner — `stream` to `finish`, checked by
 * `runOutcomeNotices` — so the badges already present at page load stay silent.
 * A failed run is the same transition carrying `runFailure`, so finish and
 * error cannot fire for one run.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { WorkspaceFolderData } from '@/shared/types';
import {
  runOutcomeNotices,
  streamOutcomes,
  type StreamOutcome,
} from '@/shared/lib/notifications/outcomes';
import { sendNotification } from '@/client/hooks/ui/notifications';

export function useRunOutcomeAlert(folders: WorkspaceFolderData[]): void {
  // Null until the first snapshot: a page load must not announce runs that had
  // already finished before it.
  const knownRef = useRef<Map<string, StreamOutcome> | null>(null);

  useEffect(() => {
    const previous = knownRef.current;
    knownRef.current = streamOutcomes(folders);
    if (!previous) return;

    for (const notice of runOutcomeNotices(previous, folders)) {
      sendNotification(notice.kind, {
        title: notice.title,
        body: notice.detail,
        tag: `${notice.kind}:${notice.sessionId}`,
        sessionId: notice.sessionId,
      });
    }
  }, [folders]);
}
