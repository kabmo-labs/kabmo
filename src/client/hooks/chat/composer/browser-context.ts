/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sibling-panel bridge: listens for a browser panel's "include page" event and
 * appends its block to the chat draft. Lives beside the timeline hooks because
 * they own the persisted draft (`chat.draft`).
 *
 * The TEXT is built by `shared/lib/browser/page-context`, not here: the same
 * block is produced by the formatter's own tests, so a second spelling in the
 * listener would let the annotated page and the plain page drift apart.
 *
 * An annotated page sends no attachment. The user panel's page is a
 * cross-origin iframe, so there are no bytes to attach — what it sends is the
 * region and the note, which the agent resolves by opening the URL itself.
 */

import { useEffect, useRef } from 'preact/hooks';
import { BROWSER_INCLUDE_PAGE_EVENT, appendPageContext } from '@/shared/lib/browser/page-context';
import { readAnnotatePanel, readAnnotationShapes } from '@/shared/lib/browser/annotate';
import { isRecord } from '@/shared/lib/util/guards';
import { readString } from '@/shared/lib/browser/util';
import type { BrowserPageContext } from '@/shared/types';

type DraftSetter = (value: string | ((prev: string) => string)) => void;

/** The parts of a dispatched detail this bridge trusts, from a DOM event. */
export function readPageContextDetail(raw: unknown): BrowserPageContext | null {
  if (!isRecord(raw)) return null;
  const url = readString(raw, 'url');
  if (!url) return null;
  const title = readString(raw, 'title');
  const detail: BrowserPageContext = { url };
  if (title) detail.title = title;
  // The marks are echoed back only when BOTH halves survive validation: a shape
  // list without its panel box cannot be turned into percentages of anything,
  // and a malformed batch degrades to the plain page context rather than to a
  // prompt carrying a broken annotation section.
  const annotations = readAnnotationShapes(raw.annotations);
  const panel = readAnnotatePanel(raw.panel);
  if (annotations && panel) {
    detail.annotations = annotations;
    detail.panel = panel;
  }
  return detail;
}

/** Append a page-context block to the composer draft on the panel event. */
export function useBrowserPageContextInsert(setInputValue: DraftSetter): void {
  const setterRef = useRef(setInputValue);
  setterRef.current = setInputValue;

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = event instanceof CustomEvent ? readPageContextDetail(event.detail) : null;
      if (!detail) return;
      setterRef.current((prev) => appendPageContext(prev, detail));
    };
    window.addEventListener(BROWSER_INCLUDE_PAGE_EVENT, handler);
    return () => window.removeEventListener(BROWSER_INCLUDE_PAGE_EVENT, handler);
  }, []);
}
