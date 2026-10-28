/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Publish the desktop editor's current document for surfaces outside it.
 *
 * The Files panel's outline reads this slot (`client/lib/editor-document.ts`),
 * so what is published has to be the LIVE buffer and a reason whenever there is
 * no outline to draw. The four no-outline states are distinct on purpose — a
 * diff tab, an image, a read that failed and a file still loading are four
 * different sentences, and an empty string cannot tell them apart.
 *
 * The phone's editor publishes nothing: its outline is a sheet drawn from its
 * own buffer (`mobile-right-sidebar/OutlineButton.tsx`), so a slot that only
 * one editor owns cannot be blanked by the other.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { OpenedFile } from '@/shared/types/fs';
import { VIEWER_LABELS, type ViewerKind } from '@/shared/lib/fs/document-kind';
import type { EditorDocument } from '@/shared/lib/code/outline/document';
import { clearEditorDocument, publishEditorDocument } from '@/client/lib/editor-document';

export interface EditorDocumentInput {
  file: OpenedFile | undefined;
  content: string;
  language: string;
  loaded: boolean;
  isLoading: boolean;
  loadError: string | null;
  viewerKind: ViewerKind;
  isBinaryViewer: boolean;
  /** The tab is drawing its rendered view rather than its source. */
  preview: boolean;
}

/**
 * Derive the document state, publish it on every render, clear the slot on
 * unmount. A `null` input publishes nothing at all — the phone's editor draws
 * its own outline and must not claim (or blank) the slot the desktop owns.
 */
export function useEditorDocument(input: EditorDocumentInput | null): void {
  const ownerRef = useRef<object>({});

  useEffect(() => {
    if (!input) return;
    publishEditorDocument(ownerRef.current, describeDocument(input));
  });

  useEffect(() => {
    const owner = ownerRef.current;
    return () => clearEditorDocument(owner);
  }, []);
}

/** The slot's value for one render of the editor. */
function describeDocument(input: EditorDocumentInput): EditorDocument {
  const { file } = input;
  if (!file) return { path: null, name: null, content: '', language: 'text', state: 'idle', note: null, preview: false };

  const base = {
    path: file.path,
    name: file.name,
    content: input.content,
    language: input.language,
    /**
     * Only MARKDOWN has a rendered view whose headings are its outline. A CSV
     * grid and an SVG picture are rendered too, but their rows are not headings
     * — a contents entry there could only be served by leaving the preview, so
     * calling them a table of contents would promise the wrong thing.
     */
    preview: input.preview && input.viewerKind === 'markdown',
  };

  if (file.isDiff) {
    return { ...base, content: '', state: 'diff', note: null, preview: false };
  }
  if (input.loadError) {
    return { ...base, state: 'error', note: input.loadError, preview: false };
  }
  if (input.isBinaryViewer) {
    return {
      ...base,
      content: '',
      state: 'not-a-document',
      note: `${VIEWER_LABELS[input.viewerKind]} files have no text outline.`,
      preview: false,
    };
  }
  if (input.isLoading || !input.loaded) {
    return { ...base, state: 'loading', note: null, preview: false };
  }
  return { ...base, state: 'ready', note: null };
}
