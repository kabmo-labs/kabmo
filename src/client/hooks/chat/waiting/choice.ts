/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's "wait for session" pick, per chat.
 *
 * Applies to whatever this chat sends NEXT: the first prompt of a pending
 * `new-…` chat, or a follow-up in a chat that already has a session. Held in
 * the session's own UI state (`chat.waitingFor`) rather than in component
 * state: the composer is remounted by a stretch, a tab switch and a reload, and
 * a pick that evaporated with it would silently send the prompt immediately —
 * the one outcome the user explicitly deferred.
 *
 * The ref is the other half, and it is not redundant: the send handler is
 * created once per deps record, so reading the pick from render state there
 * would dispatch with whatever it was when that closure was built.
 */

import { useCallback, useRef } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import type { WaitingCandidate } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';

export interface WaitingDependencyChoice {
  value: WaitingCandidate | null;
  ref: { current: WaitingCandidate | null };
  set: (candidate: WaitingCandidate | null) => void;
  clear: () => void;
}

export function useWaitingDependencyChoice(): WaitingDependencyChoice {
  const [stored, setStored] = useSessionState<WaitingCandidate | null>('chat.waitingFor', null);
  const ref = useRef<WaitingCandidate | null>(stored);
  ref.current = stored;

  // The pick belongs to THIS chat's next prompt, whatever the chat is: a pending
  // `new-…` chat defers its first send, and a chat with an omp id defers a
  // follow-up. It is cleared by the send that consumes it, never by the session
  // id changing shape — that clearing was what confined the feature to a new
  // chat's first prompt.
  const set = useCallback((candidate: WaitingCandidate | null) => {
    ref.current = candidate;
    setStored(candidate);
  }, [setStored]);

  const clear = useCallback(() => set(null), [set]);

  return { value: stored, ref, set, clear };
}
