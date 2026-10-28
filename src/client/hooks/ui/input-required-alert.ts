/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * App-wide "an agent is blocked on you" cue.
 *
 * It runs off the shared session list rather than the open timeline, which is
 * the whole point: the agent that needs an answer is usually NOT the session on
 * screen — you sent a prompt in one workspace and moved to another. The list is
 * fed by the sidebar loader (which derives `awaitingInput` from the live omp
 * process registry), so the cue reaches the client even when that process'
 * session was never opened.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { WorkspaceFolderData } from '@/shared/types';
import { triggerInputRequiredSound } from '@/client/hooks/ui/notification-sound';

export function useInputRequiredAlert(folders: WorkspaceFolderData[]): void {
  // Null until the first snapshot: a page load must not replay a cue for
  // questions that were already waiting before it.
  const knownRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const waiting = new Set<string>();
    for (const folder of folders) {
      for (const session of folder.sessions ?? []) {
        if (session.awaitingInput) waiting.add(String(session.id));
      }
    }

    const known = knownRef.current;
    knownRef.current = waiting;
    if (!known) return;
    for (const id of waiting) {
      if (known.has(id)) continue;
      triggerInputRequiredSound();
      return;
    }
  }, [folders]);
}
