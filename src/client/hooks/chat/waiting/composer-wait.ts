/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat composer's "wait for session" wiring, in one place.
 *
 * Two facts have to agree: the candidates are the sessions with a run in flight
 * (never this chat), and the held banner belongs to whichever chat the row
 * names. Keeping them in one hook is what stops the header picker and the
 * banner from reading two different lists — and it keeps `ChatTimeline` under
 * the per-file ceiling.
 */

import { useMemo } from 'preact/hooks';
import { useHeldWait } from '@/client/hooks/chat/waiting/held';
import { waitingCandidates, type WaitingCandidate } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';
import type { WorkspaceFolderData } from '@/shared/types/workspace';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

export interface ComposerWaitOptions {
  sessionId: string | null;
  folders: WorkspaceFolderData[];
  streamStatusMap: Record<string, string | undefined>;
  /** A name for a streaming id the sidebar structure has not scanned yet. */
  titleFor?: (id: string) => string | undefined;
  value: WaitingCandidate | null;
  onChange: (candidate: WaitingCandidate | null) => void;
  onNotice?: (message: string, tone?: ToastTone) => void;
  /** A held prompt for this chat was delivered by the server's sweep. */
  onDispatched?: (sessionId: string) => void;
}

export interface ComposerWait {
  /** Props for the composer header's picker. */
  waiting: {
    value: WaitingCandidate | null;
    candidates: WaitingCandidate[];
    onChange: (candidate: WaitingCandidate | null) => void;
  };
  /** Props for the held-prompt banner above the composer. */
  held: {
    heldWait: { title: string | null } | null;
    onCancelWait: () => void;
  };
}

export function useComposerWait(options: ComposerWaitOptions): ComposerWait {
  const { sessionId, folders, streamStatusMap, titleFor, value, onChange, onNotice, onDispatched } = options;
  const { heldWait, cancelHeldWait } = useHeldWait(sessionId, {
    ...(onNotice ? { onNotice } : {}),
    ...(onDispatched ? { onDispatched } : {}),
  });
  const candidates = useMemo(
    () => waitingCandidates(folders, streamStatusMap, sessionId, titleFor),
    [folders, streamStatusMap, sessionId, titleFor],
  );
  const waiting = useMemo(
    () => ({ value, candidates, onChange }),
    [value, candidates, onChange],
  );
  return {
    waiting,
    held: {
      heldWait: heldWait ? { title: heldWait.dependsOnTitle } : null,
      onCancelWait: cancelHeldWait,
    },
  };
}
