/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone editor's content area: which surface draws the open file.
 *
 * The dispatch, in order, because every branch before the code surface exists
 * for a reason the editor would get WRONG rather than merely worse:
 *
 * - a byte viewer (image, PDF, DOCX, workbook) draws its own bytes and has no
 *   text buffer, so the code surface would paint mojibake;
 * - a rendered text view (markdown, CSV grid, SVG) is the same buffer drawn as
 *   what the file IS, and it is gated on the preview toggle;
 * - the loading / refusal states and the markdown preview share one scroller,
 *   which is also where the outline's heading jump looks;
 * - the code surface owns its own (CodeMirror) scroller and must NOT be wrapped
 *   in one: an outer `overflow-auto` resolves the editor's `height: 100%`
 *   against an auto-height box, so the panel grows to the document's height and
 *   has nothing to scroll.
 *
 * Split out of `FullEditor.tsx` for the repository's per-file ceiling; the
 * order above is the whole contract, so it lives in one place.
 */

import type { RefObject } from 'preact';
import { CodeSurface, type CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { ImageViewer } from '@/client/components/common/image-viewer';
import { PreviewScroller } from '@/client/components/mobile/mobile-right-sidebar/PreviewScroller';
import type { MobileEditorFile } from '@/client/components/mobile/open-file-payload';
import { ViewerSurface, hasViewerSurface } from '@/client/components/workspace/editor/viewers/dispatch';
import type { UseFileEditorResult } from '@/client/hooks/editor/file-editor-types';
import type { ScrollRestoreBinding } from '@/client/hooks/editor/use-scroll-restore';
import type { EditorTypingOptions } from '@/client/components/common/code-surface/typing';
import type { EditorThemeState } from '@/client/hooks/editor/theme';
import { EDITOR_LINE_HEIGHT } from '@/shared/lib/code/editor/typography';
import type { ViewerKind } from '@/shared/lib/fs/document-kind';

interface MobileEditorSurfaceProps {
  file: MobileEditorFile;
  editor: UseFileEditorResult;
  viewerKind: ViewerKind;
  /** A byte-drawing viewer: its surface fetches the bytes itself. */
  byteViewer: boolean;
  isPreview: boolean;
  /** The file is markdown, so the preview branch is the document view. */
  isMd: boolean;
  content: string;
  language: string;
  wordWrap: boolean;
  fileKey: string;
  revealMarks: readonly { start: number; end: number }[] | undefined;
  currentMark: number;
  surfaceRef: RefObject<CodeSurfaceHandle>;
  setCodeScroller: (element: HTMLElement | null) => void;
  previewRef: (element: HTMLElement | null) => void;
  scroll: ScrollRestoreBinding;
  fontSize: number;
  reviewActive: boolean;
  onExitReview: () => void;
  editorTheme: EditorThemeState;
  editorFontFamily: string;
  indentUnitText: string;
  typing: EditorTypingOptions;
}

export function MobileEditorSurface({
  file,
  editor,
  viewerKind,
  byteViewer,
  isPreview,
  isMd,
  content,
  language,
  wordWrap,
  fileKey,
  revealMarks,
  currentMark,
  surfaceRef,
  setCodeScroller,
  previewRef,
  scroll,
  fontSize,
  reviewActive,
  onExitReview,
  editorTheme,
  editorFontFamily,
  indentUnitText,
  typing,
}: MobileEditorSurfaceProps) {
  if (editor.isImage && editor.imageUrl) {
    return <ImageViewer src={editor.imageUrl} name={file.name} className="flex-1 min-h-0" />;
  }
  if (editor.isImage || (hasViewerSurface(viewerKind) && (byteViewer || isPreview))) {
    return (
      <ViewerSurface
        kind={viewerKind}
        path={file.path ?? file.name}
        name={file.name}
        source={editor.byteSource}
        content={editor.content}
        revision={editor.revision}
      />
    );
  }
  if (editor.isLoading || editor.unsupported || editor.loadError || (isMd && isPreview)) {
    return (
      <PreviewScroller
        fileName={file.name}
        content={content}
        path={file.path ?? file.name}
        root={file.root}
        repo={file.repo}
        fontSize={fontSize}
        scrollRef={previewRef}
        onScroll={scroll.onScroll}
        isLoading={editor.isLoading}
        unsupported={editor.unsupported}
        loadError={editor.loadError}
        reviewActive={reviewActive}
        onExitReview={onExitReview}
      />
    );
  }
  return (
    <CodeSurface
      ref={surfaceRef}
      value={content}
      onValueChange={editor.onChange}
      language={language}
      wordWrap={wordWrap}
      documentKey={fileKey}
      marks={revealMarks}
      currentMark={currentMark}
      onScroller={setCodeScroller}
      scrollTestId="editor-scroller"
      // No `bg-paper`: an explicit editor theme paints its own surface, and the
      // panel's colour under it would be a border of the wrong shade.
      // `select-text` is the desktop pane's rule, and it matters more here: the
      // sheet's own root is `select-none` (it is a header-and-status layout), and
      // the editor is a `contenteditable` whose selection and caret are the
      // BROWSER's business — an inherited `user-select: none` is the one thing
      // that can take that away on a phone.
      className="flex-1 min-h-0 text-ink select-text"
      themeVars={editorTheme.vars}
      themes={editorTheme.themes}
      indentUnitText={indentUnitText}
      typing={typing}
      padding={12}
      placeholder="This file is empty"
      style={{ fontFamily: editorFontFamily, fontSize: `${fontSize}px`, lineHeight: EDITOR_LINE_HEIGHT }}
    />
  );
}
