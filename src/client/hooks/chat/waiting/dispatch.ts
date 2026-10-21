/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
  releasePendingSession,
} from '@/client/hooks/chat/omp/pending-sessions';
import { clearPendingSessionWaiting, pendingSessionWait } from '@/client/hooks/chat/omp/pending-waiting';
import { useSearchParams } from '@/client/lib/router/search-params';

export interface WaitingDispatchOptions {
  /** Surfaces an outcome the user must know about (a failed or cancelled wait). */
  onNotice?: (message: string) => void;
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

  useEffect(() => {
    for (const prompt of prompts) {
      const pendingId = prompt.pendingId;
      if (!pendingId) continue;
      const held = pendingSessionWait(pendingId);

      if (prompt.status === 'dispatched' && prompt.sessionId) {
        // Adopt when this tab OWNS the chat: it still holds the cue, or its URL
        // names the pending id (a reload, a second tab on the same chat). A row
        // from someone else's chat is left alone — adopting it would mint a
        // sidebar entry for a session this tab never opened.
        const openId = new URLSearchParams(window.location.search).get('sessionId');
        if (!held && openId !== pendingId) continue;
        adoptPendingSession(pendingId, prompt.sessionId, prompt.folderId);
        // The URL may still name the pending id — this tab was left on the chat
        // while the dispatch happened elsewhere.
        setSearchParams((prev) => {
          if (prev.get('sessionId') !== pendingId) return prev;
          const next = new URLSearchParams(prev);
          next.set('sessionId', prompt.sessionId as string);
          return next;
        }, { replace: true });
        noticeRef.current?.(`Waiting finished — your prompt is now running in a new session.`);
        continue;
      }

      if (prompt.status === 'error') {
        const openId = new URLSearchParams(window.location.search).get('sessionId');
        if (!held && openId !== pendingId) continue;
        clearPendingSessionWaiting(pendingId);
        releasePendingSession(pendingId);
        noticeRef.current?.(`The prompt you held was not sent: ${prompt.error ?? 'the dispatch failed.'}`);
        continue;
      }

      if (prompt.status === 'cancelled' && held) {
        clearPendingSessionWaiting(pendingId);
        noticeRef.current?.('The held prompt was cancelled.');
      }
    }
  }, [prompts, setSearchParams]);
}
