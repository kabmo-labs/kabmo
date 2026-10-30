/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether a thinking block is open, remembered per session and per message.
 *
 * The accordion kept this in a plain `useState`, and that was survivable while
 * every row stayed mounted for the life of the session. It is not survivable
 * now: `MessageList` mounts a WINDOW of rows (`useTimelineRowWindow`), so a
 * block is unmounted whenever the window moves past it — which an expand does
 * by itself, because the row it opens grows and the reader parked at the tail
 * follows the new bottom. Measured in the browser on a real session: the click
 * opened the body, the next measurement moved the viewport, the row unmounted
 * and remounted with a fresh `useState(false)`, and the block was closed again
 * — "sometimes it works" being exactly the case where enough content sat below
 * the row to keep it mounted.
 *
 * The tool cards already answer this by persisting their openness per session
 * (`useToolOpenState`), so this is the same rule for the same reason, not a
 * second convention: a block's open state belongs to the conversation.
 *
 * Only a choice the reader MADE is stored. A generating run opens by default,
 * and writing that default per block would put a row in the session blob for
 * every thought the model produced.
 */

import { useEffect, useState } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';

/** Session slot holding `{ [messageId]: open }` for the blocks the reader toggled. */
export const THINKING_OPEN_STATE_KEY = 'chat.thinkingOpen';

export interface ThinkingOpenState {
  isOpen: boolean;
  toggle: () => void;
}

/**
 * `messageId` is optional so a block mounted outside a session (a spec, a
 * preview) still toggles — it just cannot remember the choice.
 */
export function useThinkingOpenState(
  messageId: string | undefined,
  defaultOpen: boolean,
  isGenerating: boolean,
): ThinkingOpenState {
  const [stored, setStored] = useSessionState<Record<string, boolean>>(THINKING_OPEN_STATE_KEY, {});
  const [local, setLocal] = useState(defaultOpen || isGenerating);
  const choice = messageId ? stored[messageId] : undefined;

  // A run that starts streaming opens itself, as it always has. This is the
  // local half on purpose: the stored half is the reader's own choice, and it
  // must not be overwritten by a default.
  useEffect(() => {
    if (isGenerating) setLocal(true);
  }, [isGenerating]);

  const isOpen = choice ?? local;
  const toggle = (): void => {
    const next = !isOpen;
    setLocal(next);
    if (messageId) setStored((prev) => ({ ...prev, [messageId]: next }));
  };
  return { isOpen, toggle };
}
