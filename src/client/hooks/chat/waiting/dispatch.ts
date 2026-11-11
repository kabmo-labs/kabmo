/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Following a held prompt to its outcome.
 *
 * The dispatch happens on the SERVER, in a process that may be a different
 * instance, a different tab's, or one that started after this page was closed.
 * Nothing on this side sends it, so the only thing that can report it is the
 * `waiting` topic — and what a dispatched row carries is exactly what the local
 * send path produces for itself: the omp session id the spawn answered with.
 *
 * That is why the adoption is here rather than in the composer: the pending
 * row's `new-…` id has to move onto the real one whether or not the composer is
 * still mounted, and whether or not this tab is the one that created it.
 */

import { useEffect, useRef } from 'preact/hooks';
import { useWaitingPrompts } from '@/client/hooks/chat/waiting/store';
import {
  adoptPendingSession,
} from '@/client/hooks/chat/omp/pending-sessions';
import { markPendingSessionDraft, pendingSessionWait } from '@/client/hooks/chat/omp/pending-waiting';
import { restoreHeldDraft } from '@/client/hooks/chat/waiting/restore';
import { useSearchParams } from '@/client/lib/router/search-params';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

export interface WaitingDispatchOptions {
  /** Surfaces an outcome the user must know about (a failed or cancelled wait). */
  onNotice?: (message: string, tone?: ToastTone) => void;
}

/**
 * Adopt the session a held prompt became, and report the outcomes that are not
 * a dispatch.
 *
 * Mounted once, beside the sidebar's own data provider: every layout needs it,
 * and the pending row it adopts lives in the same client store both sidebars
 * read.
 */
export function useWaitingDispatch({ onNotice }: WaitingDispatchOptions = {}): void {
  const { prompts } = useWaitingPrompts();
  const [, setSearchParams] = useSearchParams();
  // The toast stack's `pushToast` is a fresh closure per render, so it must not
  // be an effect dependency: every unrelated render would re-run this walk.
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  // Rows are retained for a day, so an outcome must be handled ONCE per tab —
  // otherwise every waiting-topic frame adopts again and repeats the toast.
  const handledRef = useRef(new Set<string>());

  useEffect(() => {
    const openId = new URLSearchParams(window.location.search).get('sessionId');
    for (const prompt of prompts) {
      const pendingId = prompt.pendingId;
      const targetId = prompt.targetSessionId;
      const held = pendingId ? pendingSessionWait(pendingId) : null;
      // The chat this outcome belongs to: a pending slot this tab still holds
      // (or has open), or an existing session open in this tab.
      const ownsPending = Boolean(pendingId) && (Boolean(held) || openId === pendingId);
      const ownsTarget = Boolean(targetId) && openId === targetId;
      if (!pendingId && !targetId) continue;

      const outcomeKey = `${prompt.id}:${prompt.status}`;
      if (handledRef.current.has(outcomeKey)) continue;

      if (prompt.status === 'dispatched' && prompt.sessionId) {
        handledRef.current.add(outcomeKey);
        if (pendingId && ownsPending) {
          adoptPendingSession(pendingId, prompt.sessionId, prompt.folderId);
          // The URL may still name the pending id — this tab was left on the chat
          // while the dispatch happened elsewhere.
          setSearchParams((prev) => {
            if (prev.get('sessionId') !== pendingId) return prev;
            const next = new URLSearchParams(prev);
            next.set('sessionId', prompt.sessionId as string);
            return next;
          }, { replace: true });
          noticeRef.current?.('Waiting finished — your prompt is now running in a new session.', 'success');
        } else if (targetId && ownsTarget) {
          // The transcript reload is driven by the chat's own `useHeldWait`
          // (it sees this row flip); this is only the user-facing report.
          noticeRef.current?.('Waiting finished — your prompt is now running in this chat.', 'success');
        }
        continue;
      }

      if (prompt.status === 'error') {
        handledRef.current.add(outcomeKey);
        if (!ownsPending && !ownsTarget) continue;
        restoreHeldDraft(prompt);
        if (pendingId) markPendingSessionDraft(pendingId);
        noticeRef.current?.(
          `The prompt you held was not sent: ${prompt.error ?? 'the dispatch failed.'} Your draft is back in the composer.`,
          'error',
        );
        continue;
      }

      if (prompt.status === 'cancelled') {
        handledRef.current.add(outcomeKey);
        if (!ownsPending && !ownsTarget) continue;
        // The tab that cancelled already reported it; this covers a cancel from
        // another tab/instance. The chat and its draft are kept either way.
        restoreHeldDraft(prompt);
        if (pendingId) markPendingSessionDraft(pendingId);
      }
    }
  }, [prompts, setSearchParams]);
}
