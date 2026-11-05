/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sibling-panel bridge that hands a browser panel's page to the chat composer.
 *
 * The panel and the chat timeline are separate trees, so the page travels as a
 * DOM event rather than shared React state. This module owns BOTH halves of
 * that contract: the event, and the exact text a page context becomes in the
 * draft (`formatPageContextBlock`). The formatter lives here rather than in the
 * listener because the same block is read back by tests and by anyone
 * re-dispatching the event; two spellings of it is how the shared page and the
 * annotated page start saying different things.
 */

import type { BrowserPageContext } from '@/shared/types';
import { describeAnnotations } from '@/shared/lib/browser/annotate';

/** DOM event the browser panels dispatch to append page context to the draft. */
export const BROWSER_INCLUDE_PAGE_EVENT = 'omp:browser-include-page';

export function emitBrowserPageContext(detail: BrowserPageContext): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BrowserPageContext>(BROWSER_INCLUDE_PAGE_EVENT, { detail }));
}

/**
 * The block a page context adds to the composer draft.
 *
 * The trailing instruction is what makes a bare URL useful: the agent's browser
 * is its own, so "continue from this page" would otherwise be a claim about a
 * page the agent never loaded. With marks attached the block also states that
 * only the user can see the page — the marks are coordinates, not a picture —
 * so the agent knows to open the URL itself before acting.
 */
export function formatPageContextBlock(detail: BrowserPageContext): string {
  const lines = ['[Browser page context]', `URL: ${detail.url}`];
  if (detail.title) lines.push(`Title: ${detail.title}`);

  const panel = detail.panel;
  const description = detail.annotations && panel
    ? describeAnnotations(detail.annotations, panel)
    : [];
  if (panel && detail.annotations) {
    lines.push(`Panel: ${panel.viewportMode} ${Math.round(panel.width)}×${Math.round(panel.height)} px @${panel.zoom}%`);
  }
  if (description.length > 0 && panel) {
    lines.push(`Annotations (${description.length}):`, ...description);
    lines.push('Only the user can see this page: open the URL above yourself before changing anything.');
    // The coordinates are fractions of the panel the user was looking at, not
    // of whatever viewport the agent opens. Saying so is what lets the agent
    // resolve them (`elementFromPoint` at the same box, or scaled) instead of
    // treating a percentage as an absolute position.
    lines.push(
      `Coordinates are relative to a ${Math.round(panel.width)}×${Math.round(panel.height)} px viewport; open the page at that size and look for the element at that point.`,
    );
  }
  lines.push('(Continue from this page.)');
  return lines.join('\n');
}

/**
 * Append one page-context block to an existing draft.
 *
 * A blank draft gets the block alone; otherwise it is separated by one blank
 * line, so two "include page" clicks read as two blocks instead of one run-on
 * paragraph.
 */
export function appendPageContext(previous: string, detail: BrowserPageContext): string {
  const block = formatPageContextBlock(detail);
  if (!previous) return block;
  const separator = previous.endsWith('\n\n') ? '' : previous.endsWith('\n') ? '\n' : '\n\n';
  return `${previous}${separator}${block}`;
}
