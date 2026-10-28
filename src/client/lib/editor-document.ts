/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The document the EDITOR currently holds, published for surfaces outside it.
 *
 * The Files panel's outline has to describe the file on screen, and the only
 * place that knows what is on screen — and what the buffer currently says — is
 * the editor. `useFileEditor`'s buffer is private to the component that called
 * it, so the panel had no way to ask.
 *
 * **The live buffer is what is published, never a re-read from disk.** The
 * autosave is debounced, so between a keystroke and its write the file on disk
 * is the OLD text: an outline derived from a second read would point every row
 * at the line it held before the user's edit, and a click would land on the
 * wrong declaration. Offsets computed from this buffer match the surface by
 * construction.
 *
 * Two rules keep the slot honest:
 *
 * - **A publish is owned.** Only the desktop editor publishes (the phone's
 *   full-screen editor draws its own outline from its own buffer, in a sheet),
 *   but a workspace switch can still mount a second editor over the first
 *   while the old one unmounts, and a late cleanup must not blank a slot a
 *   newer publisher now owns. So `clearEditorDocument` only clears when the
 *   caller is still the owner.
 * - **The slot describes why it has nothing, not just that it has nothing.** "No
 *   file open", "this tab is a diff", "still reading" and "the read failed" are
 *   four different sentences in the panel, and an empty `content` alone cannot
 *   tell them apart.
 */

import type { EditorDocument } from '@/shared/lib/code/outline/document';

export type { EditorDocument, EditorDocumentState } from '@/shared/lib/code/outline/document';

export const EMPTY_EDITOR_DOCUMENT: EditorDocument = {
  path: null,
  name: null,
  content: '',
  language: 'text',
  state: 'idle',
  note: null,
  preview: false,
};

let current: EditorDocument = EMPTY_EDITOR_DOCUMENT;
let owner: object | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function sameDocument(a: EditorDocument, b: EditorDocument): boolean {
  return (
    a.path === b.path &&
    a.name === b.name &&
    a.content === b.content &&
    a.language === b.language &&
    a.state === b.state &&
    a.note === b.note &&
    a.preview === b.preview
  );
}

/** The published document. Stable identity between publishes, so a subscriber can compare. */
export function getEditorDocument(): EditorDocument {
  return current;
}

export function subscribeEditorDocument(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish `document` as the editor's current state, owned by `source`. */
export function publishEditorDocument(source: object, document: EditorDocument): void {
  owner = source;
  // A re-render with an unchanged document is not news: without this, every
  // render that changed nothing (a hover, a panel resize) re-rendered the
  // outline and re-ran its scan.
  if (sameDocument(current, document)) return;
  current = document;
  emit();
}

/**
 * Clear the slot, if `source` still owns it.
 *
 * Called from the editor's unmount. A publisher that was already replaced (a
 * second editor mounted over the first) leaves the newer document in place.
 */
export function clearEditorDocument(source: object): void {
  if (owner !== source) return;
  owner = null;
  current = EMPTY_EDITOR_DOCUMENT;
  emit();
}

/** Test seam: drop the slot without an owner. */
export function resetEditorDocument(): void {
  owner = null;
  current = EMPTY_EDITOR_DOCUMENT;
  emit();
}
