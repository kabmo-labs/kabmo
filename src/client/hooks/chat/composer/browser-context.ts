/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sibling-panel bridge: listens for the browser panel's "include page" event
 * and appends a structured page-context block to the chat draft. Lives beside
 * the timeline hooks because they own the persisted draft (`chat.draft`).
 */

import { useEffect, useRef } from 'preact/hooks';
import { BROWSER_INCLUDE_PAGE_EVENT } from '@/shared/lib/browser/page-context';
import { readString } from '@/shared/lib/browser/util';
import { isRecord } from '@/shared/lib/util/guards';

type DraftSetter = (value: string | ((prev: string) => string)) => void;

/** Append the browser page-context block to the composer draft on the panel event. */
export function useBrowserPageContextInsert(setInputValue: DraftSetter): void {
  const setterRef = useRef(setInputValue);
  setterRef.current = setInputValue;

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (!isRecord(detail)) return;
      const url = readString(detail, 'url');
      if (!url) return;
      const title = readString(detail, 'title');
      setterRef.current((prev) => {
        const separator = prev && !prev.endsWith('\n') ? '\n\n' : prev ? '\n' : '';
        const titleLine = title ? `\nJudul: ${title}` : '';
        return `${prev}${separator}[Konteks halaman browser]\nURL: ${url}${titleLine}\n(Lanjutkan dari halaman ini.)`;
      });
    };
    window.addEventListener(BROWSER_INCLUDE_PAGE_EVENT, handler);
    return () => window.removeEventListener(BROWSER_INCLUDE_PAGE_EVENT, handler);
  }, []);
}
