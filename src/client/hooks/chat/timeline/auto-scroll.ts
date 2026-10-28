/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Follow-bottom when a session is opened. Committed history is fetched
 * asynchronously (session-load.ts), so the timeline paints at `scrollTop = 0`
 * long before the messages land — and nothing else scrolls a finished session,
 * because every other trigger lives in the streaming callbacks. This jumps to
 * the tail exactly once per session, on the commit where that session's
 * messages appear.
 *
 * The jump is the UNCONDITIONAL one (`jumpToBottom`), not the follow-gated
 * `scrollToBottom`. Follow mode is a property of this mounted view, not of the
 * session being opened: a user who scrolled up before switching left it
 * disengaged, and the open then painted the top of the new session with no
 * scroll event to re-engage it — the session stayed at the head until the
 * button was clicked (reproduced: scroll up in session A, open session B,
 * `scrollTop` pinned at 0 with the jump button showing).
 */

import type { RefObject } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { ChatMessageData } from '@/shared/types';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface UseTimelineAutoScrollDeps {
  sessionId: string | null;
  /** Committed timeline; its identity changes when history lands. */
  messages: ChatMessageData[];
  /** Scroll container owned by useChatTimelineScroll. */
  scrollRef: RefObject<HTMLDivElement>;
  /** Unconditional tail jump (bypasses follow mode, re-engages it). */
  jumpToBottom: (behavior?: ScrollBehavior) => void;
  /** Pending "new-…" sessions render the workspace picker, which owns its own
   *  timeline and scroll handling. */
  enabled: boolean;
}

export function useTimelineAutoScroll(deps: UseTimelineAutoScrollDeps): void {
  const { sessionId, messages, scrollRef, jumpToBottom, enabled } = deps;
  // Session the container was last rendering. On the commit where this flips
  // the DOM still holds the previous session's rows, so scrolling then would
  // aim at content that is about to be replaced.
  const renderedRef = useRef<string | null>(null);
  // Session whose opening scroll has already been served.
  const servedRef = useRef<string | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (renderedRef.current !== sessionId) {
      renderedRef.current = sessionId;
      servedRef.current = null;
      return;
    }
    if (!enabled || !sessionId || messages.length === 0) return;
    if (servedRef.current === sessionId) return;
    if (!scrollRef.current) return;
    servedRef.current = sessionId;
    // Layout effect + 'instant': the rows are already committed and reading
    // scrollHeight forces layout, so the jump lands before the browser paints.
    // 'instant' is required because the container carries Tailwind's
    // `scroll-smooth`, which 'auto' would resolve to.
    jumpToBottom('instant');
  }, [sessionId, messages, enabled, scrollRef, jumpToBottom]);
}
