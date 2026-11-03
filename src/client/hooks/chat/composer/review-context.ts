/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sibling-surface bridge: the editor's document review appended to the chat
 * draft.
 *
 * A DOM event rather than shared state, for the same reason the browser panel's
 * page context is one: the editor column and the chat timeline are separate
 * trees, and the draft belongs to the timeline's own persisted hook
 * (`chat.draft`). `formatReviewBlock` in `shared/lib/markdown/review/prompt.ts`
 * owns the TEXT — two spellings of it is how the annotated document and the
 * plain one start saying different things.
 */

import { useEffect, useRef } from 'preact/hooks';

import { REVIEW_INCLUDE_EVENT, appendReviewBlock } from '@/shared/lib/markdown/review/prompt';

type DraftSetter = (value: string | ((prev: string) => string)) => void;

/** Append a review block to the composer draft on the editor's event. */
export function useReviewIncludeInsert(setInputValue: DraftSetter): void {
  const setterRef = useRef(setInputValue);
  setterRef.current = setInputValue;

  useEffect(() => {
    const handler = (event: Event): void => {
      const block = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : '';
      if (!block) return;
      setterRef.current((previous) => appendReviewBlock(previous, block));
    };
    window.addEventListener(REVIEW_INCLUDE_EVENT, handler);
    return () => window.removeEventListener(REVIEW_INCLUDE_EVENT, handler);
  }, []);
}
