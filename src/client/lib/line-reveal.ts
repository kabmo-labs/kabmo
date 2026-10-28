/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The hand-off from an outline row to whichever editor is drawing its file.
 *
 * A symbol click has to do two things at different moments: the file is already
 * the editor's tab, but the SELECTION can only be placed once that file's bytes
 * are on screen. The request therefore cannot ride on the tab entry — that entry
 * is persisted per session, so a reload would re-fire a jump the user already
 * took.
 *
 * It is a separate store from `search-reveal` on purpose. A search jump also
 * opens the find bar on its query and paints every occurrence, which is exactly
 * what a symbol jump must NOT do: an outline row names a declaration, and
 * covering it with a find bar would hide the line it was asked to show.
 *
 * The request names a LINE plus the NAME's span, not a document offset: an
 * outline is computed from a document, and line/column is the unit both sides
 * share. The editor resolves it against its own buffer at serve time, so the
 * jump lands on the declaration the row pointed at even if the file was edited
 * in between. Selecting the name's own span is what makes the click show the
 * reader WHICH identifier it landed on — a bare caret at the start of
 * `export class Widget {` sits on the word `export`.
 */

export interface LineRevealRequest {
  /** Workspace-relative path of the file the line lives in. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column where the name starts; omitted means the line's start. */
  column?: number;
  /** Length of the name, so the selection covers the identifier itself. */
  length?: number;
}

let pending: LineRevealRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Publish a request; `null` clears it once an editor has served it. */
export function setLineReveal(request: LineRevealRequest | null): void {
  pending = request;
  emit();
}

/** The pending request, for a consumer that has to re-check after its own load. */
export function getLineReveal(): LineRevealRequest | null {
  return pending;
}

export function subscribeLineReveal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
