/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sibling-panel bridge that hands the AGENT browser's current page to the chat
 * composer. The agent panel and the chat timeline are separate trees, so the
 * page is passed through a DOM event rather than shared React state.
 */

import type { BrowserPageContext } from '@/shared/types';

/** DOM event the agent browser panel dispatches to append page context to the draft. */
export const BROWSER_INCLUDE_PAGE_EVENT = 'omp:browser-include-page';

export function emitBrowserPageContext(detail: BrowserPageContext): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BrowserPageContext>(BROWSER_INCLUDE_PAGE_EVENT, { detail }));
}
