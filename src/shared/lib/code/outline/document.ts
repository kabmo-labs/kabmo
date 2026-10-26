/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shape of "the document the editor is holding", and the vocabulary for why
 * it may have no outline.
 *
 * The type lives in `shared` because the empty-state wording does: the panel
 * says "still reading", "could not read this" and "no symbols" with three
 * different sentences, and that table must not be duplicated per surface. The
 * STORE is client-only (`client/lib/editor-document.ts`) — nothing on the
 * server has an editor.
 *
 * `diff` is its own state rather than a `not-a-document` with a note, because a
 * diff tab HIDES the outline instead of explaining it: a reader comparing two
 * versions of a file has no source document to outline, so a section that
 * announced "diff tabs have no outline" was chrome occupying the panel floor for
 * a question nobody asked.
 */

export type EditorDocumentState = 'idle' | 'loading' | 'ready' | 'error' | 'not-a-document' | 'diff';

export interface EditorDocument {
  /** Workspace-relative path of the file on screen, or null when nothing is open. */
  path: string | null;
  /** Display name, so a notice can name the file it is about. */
  name: string | null;
  /** The LIVE buffer — what the surface is drawing right now. */
  content: string;
  /** Shiki language id, as the editor resolved it from the name. */
  language: string;
  state: EditorDocumentState;
  /** Why the tab has no outline to draw, when `state` is `not-a-document` or `error`. */
  note: string | null;
  /**
   * The tab is drawing its RENDERED view (a markdown preview), not its source.
   *
   * It changes what the outline IS, not merely how it looks. A preview has no
   * lines and no code surface, so a row cannot move a caret: the list becomes a
   * table of contents, and a row scrolls the rendered document to its heading
   * while staying in the preview. A row that published a line request there
   * would either do nothing or throw the reader out of the document they are
   * reading.
   */
  preview: boolean;
}

const NOTICES: Record<EditorDocumentState, string> = {
  idle: 'No file open in the editor.',
  loading: 'Reading the file…',
  error: 'Could not read this file.',
  'not-a-document': 'This tab has no outline.',
  diff: 'Diff tabs have no outline.',
  ready: 'No symbols found.',
};

/**
 * Why an outline has no rows, as one sentence.
 *
 * A caller's own `note` wins where it exists — it names the actual cause (the
 * read failure's message, the viewer kind) rather than the state's category.
 */
export function outlineEmptyNotice(state: EditorDocumentState, note?: string | null): string {
  return note ?? NOTICES[state];
}
