/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's "wait for session" pick, per chat.
 *
 * Held in the session's own UI state (`chat.waitingFor`) rather than in
 * component state: the composer is remounted by a stretch, a tab switch and a
 * reload, and a pick that evaporated with it would silently send the prompt
 * immediately — the one outcome the user explicitly deferred.
 *
 * The ref is the other half, and it is not redundant: the send handler is
 * created once per deps record, so reading the pick from render state there
 * would dispatch with whatever it was when that closure was built.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import type { WaitingCandidate } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';

export interface WaitingDependencyChoice {
  value: WaitingCandidate | null;
  ref: { current: WaitingCandidate | null };
  set: (candidate: WaitingCandidate | null) => void;
  clear: () => void;
}

export function useWaitingDependencyChoice(sessionId: string | null): WaitingDependencyChoice {
  const [stored, setStored] = useSessionState<WaitingCandidate | null>('chat.waitingFor', null);
  const ref = useRef<WaitingCandidate | null>(stored);
  ref.current = stored;

  // The pick belongs to ONE chat's next prompt. A pending chat is replaced by
  // the id a spawn adopts, which is a different slot — so nothing has to be
  // cleared for the normal path. This covers the other direction: a session that
  // is not pending at all has no use for a pick, and a stale value there would
  // be applied by the next New Session the user opens in that slot.
  const pending = Boolean(sessionId?.startsWith('new-'));
  useEffect(() => {
    if (!pending && stored !== null) setStored(null);
  }, [pending, stored, setStored]);

  const set = useCallback((candidate: WaitingCandidate | null) => {
    ref.current = candidate;
    setStored(candidate);
  }, [setStored]);

  const clear = useCallback(() => set(null), [set]);

  return { value: stored, ref, set, clear };
}
