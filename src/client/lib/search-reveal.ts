/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The hand-off from a search row to whichever editor opens its file.
 *
 * A click on a result has to do two things that happen at different times: open
 * the tab (synchronously, through `omp:open-file`) and point the editor at the
 * match (only once the file's bytes are on screen). The tab entry is persisted
 * per session, so the target cannot ride on it — a reload would restore a
 * request that was already served. It lives here instead, as one pending
 * request, and the editor that finds its file open consumes it.
 *
 * The request names a LINE, not a column, and that is exact rather than
 * approximate: ripgrep emits one frame per matched line, so one row is one line
 * and "the first match on this line" is the hit the user clicked. A column
 * would have to be an offset into the row's trimmed text, which says nothing
 * about where the line starts in the file.
 *
 * `path` is the workspace-relative path both surfaces already speak, so the
 * editor can decide by equality whether the request is for the file it holds.
 */

import type { FindOptions } from '@/shared/lib/code/editor/find-scan';

export interface SearchRevealRequest {
  /** Workspace-relative path of the file the match lives in. */
  path: string;
  /** 1-based line number, as the search reported it. */
  line: number;
  /** The query, so the editor can highlight every match in the opened file. */
  query: string;
  /** The query's flags, carried so the highlight matches the search's own. */
  options: FindOptions;
}

let pending: SearchRevealRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Publish a request; `null` clears it once the editor has served it. */
export function setSearchReveal(request: SearchRevealRequest | null): void {
  pending = request;
  emit();
}

/** The pending request, for a consumer that has to re-check after its own load. */
export function getSearchReveal(): SearchRevealRequest | null {
  return pending;
}

/** Subscribe to request changes. Returns the unsubscribe. */
export function subscribeSearchReveal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
