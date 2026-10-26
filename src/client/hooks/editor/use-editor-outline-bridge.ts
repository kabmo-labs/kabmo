/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's half of the outline: publish what it is drawing, and serve the
 * jumps an outline row asks for.
 *
 * Both editors call this once, so the two behaviours cannot be wired up
 * separately — an editor that published its document but never served a request
 * would render an outline whose every row does nothing.
 *
 * The publish side is desktop-only (the phone's outline is a sheet drawn from
 * its own buffer); the jump side is shared, because the store is what both
 * editors answer to.
 */

import type { RefObject } from 'preact';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import type { UseFileEditorResult } from '@/client/hooks/editor/use-file-editor';
import type { OpenedFile } from '@/shared/types/fs';
import { useEditorDocument } from '@/client/hooks/editor/use-editor-document';
import { useLineJump } from '@/client/hooks/editor/use-line-jump';

export interface EditorOutlineBridge {
  /** The file on screen, or undefined when the column is empty. */
  file: OpenedFile | undefined;
  editor: UseFileEditorResult;
  surfaceRef: RefObject<CodeSurfaceHandle | null>;
  /** The active document is showing its rendered view rather than its source. */
  isPreview: boolean;
  /** Switch the active document back to its source. */
  exitPreview: () => void;
  /** Publish the document for the Files panel's outline. Default true. */
  publish?: boolean;
}

export function useEditorOutlineBridge({
  file,
  editor,
  surfaceRef,
  isPreview,
  exitPreview,
  publish = true,
}: EditorOutlineBridge): void {
  // Hooks cannot be conditional, so the publish hook is always called; `publish`
  // decides whether it describes a document at all (the phone's editor draws its
  // own outline from its own buffer and must not claim the desktop's slot).
  useEditorDocument(
    publish
      ? {
          file,
          content: editor.content,
          language: editor.language,
          loaded: editor.loaded,
          isLoading: editor.isLoading,
          loadError: editor.loadError,
          viewerKind: editor.viewerKind,
          isBinaryViewer: editor.isBinaryViewer,
          preview: isPreview,
        }
      : null,
  );

  useLineJump({
    path: file?.path ?? null,
    content: editor.content,
    ready: editor.loaded && !editor.loadError,
    surfaceRef,
    isPreview,
    exitPreview,
  });
}
