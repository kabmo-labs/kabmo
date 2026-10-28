/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * FIFO queue of pending omp ask/approval dialogs.
 *
 * omp runs a turn's tool calls concurrently, and every gated call emits its OWN
 * `extension_ui_request` and then blocks until that exact id is answered: two
 * `bash` calls in one turn under `always-ask` produce two `select` frames in the
 * same second. A single dialog slot kept only the last request, so each earlier
 * tool call stayed blocked on an approval nobody could answer and the turn never
 * reached `agent_end` — the run looked hung until Stop.
 *
 * The queue keeps EVERY pending request rather than the head alone: `ask` raises
 * one frame per question, and those are rendered inline on the ask tool card
 * (see ask-frames.ts) instead of in a modal, so the head is not the only
 * answerable request at any moment. Entries leave the queue by id once their
 * response is on the wire, or when omp withdraws them (`method: 'cancel'`).
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';

export interface ExtensionDialogQueue {
  /** Still-blocking requests, in omp's arrival order. */
  pending: ExtensionUiDialogRequest[];
  enqueue: (request: ExtensionUiDialogRequest) => void;
  /** Advance past a request once its response has been sent. */
  resolve: (id: string) => void;
  /** Drop a request omp withdrew (`method: 'cancel'`) without an answer. */
  withdraw: (targetId: string) => void;
}

export function useExtensionDialogQueue(sessionId: string | null): ExtensionDialogQueue {
  const [queue, setQueue] = useState<ExtensionUiDialogRequest[]>([]);

  // A pending request belongs to the session whose omp process raised it, and
  // the frame is never re-delivered: carrying it into another session would
  // answer the wrong process.
  useEffect(() => {
    setQueue([]);
  }, [sessionId]);

  const enqueue = useCallback((request: ExtensionUiDialogRequest) => {
    // Replay-on-reattach can race the live stream for the same request; one
    // entry per omp id keeps the queue answerable exactly once.
    setQueue((current) => (current.some((pending) => pending.id === request.id) ? current : [...current, request]));
  }, []);
  const resolve = useCallback((id: string) => {
    setQueue((current) => current.some((pending) => pending.id === id) ? current.filter((pending) => pending.id !== id) : current);
  }, []);
  const withdraw = useCallback((targetId: string) => {
    setQueue((current) => current.filter((pending) => pending.id !== targetId));
  }, []);

  return { pending: queue, enqueue, resolve, withdraw };
}
