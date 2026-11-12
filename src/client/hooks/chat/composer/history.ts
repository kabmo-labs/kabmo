/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ArrowUp / ArrowDown prompt recall for the chat composer.
 *
 * The list is fetched, never derived from the mounted transcript: the timeline
 * only mounts a window of a long chat (`useChatTimeline` pages the newest
 * rows), so a recall built from `messages` would forget everything the user
 * paged past. The server owns the list and scopes it — one chat's own prompts
 * on an open session, every session's prompts merged on a pending `new-…`
 * chat — so this hook only holds the cursor.
 *
 * One GET per entry into the list (each `ArrowUp` from the draft), so a chat
 * that just sent a prompt recalls it without polling: the fetch is what makes
 * the newest entry the newest. Everything after that is in memory, and the
 * fetch is lazy — a composer nobody presses ArrowUp in costs nothing.
 *
 * The rules, each of which has a failing case in the unit test:
 * - `-1` is the draft the user was typing. ArrowUp from there ENTERS the list;
 *   ArrowDown from there is a plain caret move and is left alone.
 * - Neither end wraps: past the newest entry, and back down past the oldest to
 *   the draft, nothing happens.
 * - Arrow moves only at the list's edges of the TEXT: ArrowUp on the second
 *   line of a multi-line draft must move the caret, not recall.
 * - A modified arrow (Shift/Ctrl/Cmd/Alt) is never consumed — Shift+ArrowUp is
 *   a selection.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { KeyboardEvent, RefObject } from 'preact/compat';
import {
  canRecallDown,
  canRecallUp,
  stepHistoryCursor,
  type HistoryDirection,
} from '@/shared/lib/chat/composer/history';

export interface ComposerHistoryOptions {
  value: string;
  onChange: (value: string) => void;
  /** The open chat. A pending `new-…` id (or `null`) asks for the merged list. */
  sessionId: string | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export interface ComposerHistory {
  /** Consume the key when it recalled something; false leaves the caret alone. */
  handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

export async function fetchPromptHistory(sessionId: string | null): Promise<string[]> {
  const scope = sessionId && !sessionId.startsWith('new-') ? sessionId : null;
  const query = scope ? `?sessionId=${encodeURIComponent(scope)}` : '';
  const response = await fetch(`/api/chat/prompt-history${query}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { prompts?: unknown };
  return Array.isArray(body.prompts) ? body.prompts.filter((text): text is string => typeof text === 'string') : [];
}

export function useComposerHistory({ value, onChange, sessionId, textareaRef }: ComposerHistoryOptions): ComposerHistory {
  /** Newest first, as the route answers it. */
  const entriesRef = useRef<string[]>([]);
  const cursorRef = useRef(-1);
  /** The draft the list was entered from, restored on the way back down. */
  const draftRef = useRef('');

  // A list belongs to ONE session: carrying it across a switch would offer the
  // prompts of the chat the user just left.
  useEffect(() => {
    entriesRef.current = [];
    cursorRef.current = -1;
    draftRef.current = '';
  }, [sessionId]);

  // An emptied draft is a SENT prompt (or a cleared one): the next ArrowUp must
  // start from the newest entry again, not continue from where the last recall
  // left off.
  useEffect(() => {
    if (value === '') cursorRef.current = -1;
  }, [value]);

  const apply = useCallback((text: string) => {
    onChange(text);
    // The value lands on the next render; the caret must follow the text that
    // arrived, not the one the textarea still holds in this tick.
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.setSelectionRange(text.length, text.length);
    });
  }, [onChange, textareaRef]);

  const step = useCallback((direction: HistoryDirection): boolean => {
    const next = stepHistoryCursor(entriesRef.current.length, cursorRef.current, direction);
    if (next === null) return false;
    cursorRef.current = next;
    apply(next === -1 ? draftRef.current : entriesRef.current[next]);
    return true;
  }, [apply]);

  const handleKey = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const key = event.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return false;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    // An IME composition owns the arrows: picking a candidate is not a recall.
    if (event.isComposing) return false;

    const element = textareaRef.current;
    if (!element) return false;
    const caret = element.selectionStart ?? value.length;
    const direction: HistoryDirection = key === 'ArrowUp' ? 'up' : 'down';

    if (cursorRef.current !== -1) {
      // Inside the list. Down is only recall while the caret is on the last
      // line; up never leaves the list early (both ends refuse, no wrap).
      if (direction === 'down' && !canRecallDown(value, caret)) return false;
      event.preventDefault();
      step(direction);
      return true;
    }

    // In the draft. Down is an ordinary caret move; up has to start on the
    // first line, and only then is the list fetched.
    if (direction === 'down' || !canRecallUp(value, caret)) return false;
    event.preventDefault();
    draftRef.current = value;
    void fetchPromptHistory(sessionId)
      .then((entries) => {
        entriesRef.current = entries;
        // The cursor may have been reset by a session switch while this was in
        // flight; the effect cleared the draft, so start from the top again.
        cursorRef.current = -1;
        draftRef.current = value;
        step('up');
      })
      // Nothing was substituted: the caret simply did not move, and the next
      // ArrowUp asks again.
      .catch(() => {});
    return true;
  }, [sessionId, step, textareaRef, value]);

  return { handleKey };
}
