import { useCallback, useRef, useState } from 'preact/hooks';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { countConflicts } from '@/client/components/common/code-surface/conflict-markers';
import { EditorHeader } from '@/client/components/mobile/mobile-right-sidebar/Header';
import { SaveDeletedFileModal } from '@/client/components/workspace/editor/SaveDeletedFileModal';
import { ExternalChangeStrip } from '@/client/components/workspace/editor/ExternalChangeStrip';
import { MobileEditorSurface } from '@/client/components/mobile/mobile-right-sidebar/EditorSurface';
import { MissingFileBanner } from '@/client/components/mobile/mobile-right-sidebar/MissingFileBanner';
import { EditorStatusBar } from '@/client/components/mobile/mobile-right-sidebar/StatusBar';
import { EditorDropOverlay } from '@/client/components/workspace/editor/EditorDropOverlay';
import { useEditorDrop } from '@/client/hooks/editor/use-editor-drop';
import { useScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import { useHeadingJump } from '@/client/hooks/editor/use-heading-jump';
import { useFileEditor } from '@/client/hooks/editor/use-file-editor';
import { useMobileEditorFind } from '@/client/hooks/editor/use-mobile-editor-find';
import { FindWidget } from '@/client/components/workspace/editor/FindWidget';

import { useEditorOutlineBridge } from '@/client/hooks/editor/use-editor-outline-bridge';
import { MobileOutlineButton } from '@/client/components/mobile/mobile-right-sidebar/OutlineButton';
import { useOutlineView } from '@/client/hooks/editor/use-outline-view';
import {
  EDITOR_DEFAULT_FONT_SIZE,
  EDITOR_MAX_FONT_SIZE,
  EDITOR_MIN_FONT_SIZE,
} from '@/shared/lib/code/editor/typography';
import { useEditorFontStack } from '@/client/hooks/editor/font';
import { useEditorTheme } from '@/client/hooks/editor/theme';
import { indentUnitFor, useEditorIndent } from '@/client/hooks/editor/indent-settings';
import { useEditorTyping } from '@/client/hooks/editor/typing-settings';
import { useFileReviewMode } from '@/client/hooks/editor/use-file-review-mode';
import { MOBILE_SCROLL_POSITIONS_KEY } from '@/shared/lib/workspace/scroll-positions';
import { BINARY_VIEWERS, RENDERED_VIEWERS, VIEWER_LABELS, viewerKindFor } from '@/shared/lib/fs/document-kind';
import type { MobileFullEditorProps } from '@/client/components/mobile/mobile-right-sidebar/editor-props';

export function MobileFullEditor({ file, missing = false, onClose, onFileSaved, onDropResult }: MobileFullEditorProps) {
  const viewerKind = viewerKindFor(file.path ?? file.name);
  // The default preview is DERIVED, never a `useState` initializer: this editor
  // stays mounted while the file it names changes, so an initializer computed
  // once left the toggle stuck on the first file's kind — opening a CSV after a
  // PDF kept `false` and drew the raw text where the grid belongs. The override
  // map is per file (the phone shows one file at a time), which is the same
  // per-tab memory the desktop pane keeps.
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = useState(EDITOR_DEFAULT_FONT_SIZE);

  const [wordWrap, setWordWrap] = useState(true);
  const editorFontFamily = useEditorFontStack();
  const editorTheme = useEditorTheme();
  const editorIndent = useEditorIndent();
  const editorTyping = useEditorTyping();

  const isMd = viewerKind === 'markdown';
  // A byte viewer (image, PDF, DOCX, workbook) owns the whole surface and has
  // no text buffer, so its read is skipped and the write path is refused — the
  // same contract the desktop pane applies through the hook's own flag.
  const byteViewer = BINARY_VIEWERS[viewerKind] === true;
  const hasPreview = RENDERED_VIEWERS[viewerKind] === true;
  const fileKey = file.path ?? file.name;
  // The picture/grid/prose is what the file was opened to read, so a rendered
  // kind defaults to its preview and only a user's own toggle moves it.
  const isPreview = previewOverrides[fileKey] ?? hasPreview;
  // Review mode is the same per-tab toggle the desktop pane uses (one key, one
  // rule), and it exists only where a rendered markdown document is on screen —
  // a CSV grid and an SVG picture have no markdown blocks to judge.
  const review = useFileReviewMode(String(fileKey));
  const hasReview = isMd && isPreview;
  const togglePreview = () => setPreviewOverrides((prev) => ({ ...prev, [fileKey]: !isPreview }));

  // The full-screen editor is the phone's editor panel, so it is a drop target
  // of its own — it covers the chat screen entirely while open.
  const drop = useEditorDrop({ enabled: Boolean(file.root), onResult: onDropResult });

  const editor = useFileEditor(file, {
    flushOnUnmount: true,
    reportSaveError: true,
    downloadMimeType: 'text/plain;charset=utf-8',
    onFileSaved,
    // The write path stands down on a deleted file (and asks before a Save
    // recreates it) — see `use-file-writes.ts`.
    missing,
  });

  /**
   * The code surface's scroller, which belongs to CodeMirror and appears only
   * once its view mounts.
   */
  const [codeScroller, setCodeScroller] = useState<HTMLElement | null>(null);

  // Closing and reopening the same file is a remount, so the offset is restored
  // from the session's own state — the phone shows one file at a time, and its
  // key is that file's path (a rendered view keeps its own offset, as on the
  // desktop, because the prose and the source are different documents).
  const scroll = useScrollRestore({
    tabKey: fileKey,
    surface: isMd && isPreview ? 'rendered' : 'code',
    ready: editor.loaded,
    // Its own slot: this editor is keyed by path, the desktop column by tab id,
    // and the desktop drops entries when a tab closes — against ids that mean
    // nothing here.
    slot: MOBILE_SCROLL_POSITIONS_KEY,
    // The code surface's scroller belongs to CodeMirror and appears only once
    // its view mounts; the markdown preview owns its own container.
    element: isMd && isPreview ? undefined : codeScroller,
  });

  /**
   * The preview's own scroller, for the phone's outline sheet.
   *
   * One ref for two owners: the restore hook needs the element, and a CONTENTS
   * row needs to find headings inside it. A rendered document has no code
   * surface and no lines, so a row there scrolls the page rather than moving a
   * caret — and stays in the preview the reader is looking at.
   */
  const [previewScroller, setPreviewScroller] = useState<HTMLElement | null>(null);
  const previewRef = useCallback(
    (element: HTMLElement | null) => {
      scroll.ref(element);
      setPreviewScroller(element);
    },
    [scroll.ref],
  );
  useHeadingJump({ path: file.path ?? null, scroller: previewScroller, preview: isMd && isPreview });

  const surfaceRef = useRef<CodeSurfaceHandle | null>(null);
  // Find, and the search row's hand-off. Both are the desktop's own hooks: a second
  // implementation would be a second answer to "which occurrences count", and the phone
  // was the one surface with no way to search a file at all.
  const { find, revealMarks, currentMark } = useMobileEditorFind({
    path: file.path ?? null,
    content: editor.content,
    documentKey: `${fileKey}\u0000${editor.language}`,
    ready: editor.loaded && !editor.loadError,
    surfaceRef,
    toggleWordWrap: () => setWordWrap((previous) => !previous),
  });

  const content = editor.content;
  const lang = editor.language;
  const linesCount = content.split('\n').length;
  // The same count the desktop strip prints, from the same helper: a conflicted
  // file opened on a phone must say so before the reader scrolls into it.
  const conflicts = countConflicts(content);

  /**
   * Serve an outline row's jump: caret on the line, scrolled into view.
   *
   * Served here rather than by the desktop editor because this is the surface
   * holding the buffer while the sheet is open. `publish: false` — the phone's
   * outline is drawn from this buffer directly, and publishing would claim the
   * slot the desktop panel reads. See `use-line-jump.ts`.
   */
  useEditorOutlineBridge({
    file: { id: fileKey, name: file.name, path: file.path ?? fileKey },
    editor,
    surfaceRef,
    isPreview,
    exitPreview: () => setPreviewOverrides((prev) => ({ ...prev, [fileKey]: false })),
    publish: false,
  });

  // The sheet's own list, from the LIVE buffer — the same derivation the
  // desktop section uses, so the two cannot disagree about what a state means.
  // A byte viewer has no text buffer to scan, which is its own sentence.
  const {
    symbols: outlineSymbols,
    total: outlineTotal,
    truncated: outlineTruncated,
    notice: outlineNotice,
  } = useOutlineView({
    content,
    language: lang,
    path: file.path ?? null,
    state: byteViewer ? 'not-a-document' : editor.loadError ? 'error' : editor.loaded ? 'ready' : 'loading',
    note: byteViewer
      ? `${VIEWER_LABELS[viewerKind]} files have no text outline.`
      : editor.loadError,
  });

  return (
    <div
      className="fixed inset-x-0 top-0 h-dvh z-[60] bg-paper flex flex-col font-mono text-xs select-none"
      {...drop.dropProps}
      {...drop.captureDropProps}
    >
      <EditorDropOverlay visible={drop.isDragging} />
      
      <EditorHeader
        fileName={file.name}
        hasPreview={hasPreview}
        isPreview={isPreview}
        wordWrap={wordWrap}
        copied={editor.copied}
        byteViewer={byteViewer}
        missing={missing}
        onSave={editor.saveNow}
        onClose={onClose}
        onTogglePreview={togglePreview}
        hasReview={hasReview}
        isReviewing={hasReview && review.active}
        onToggleReview={review.toggle}
        onToggleFind={() => (find.open ? find.close() : find.openFind())}
        findOpen={find.open}
        onToggleWrap={() => setWordWrap(!wordWrap)}
        onZoomOut={() => setFontSize(prev => Math.max(EDITOR_MIN_FONT_SIZE, prev - 1))}
        onZoomIn={() => setFontSize(prev => Math.min(EDITOR_MAX_FONT_SIZE, prev + 1))}
        onCopy={editor.copy}
        onDownload={editor.download}
      />

{missing && <MissingFileBanner />}

      {/* The same strip the desktop pane draws, from the same verdict: the disk
          bytes differ from a buffer that has edits. A clean buffer never reaches
          here — the watcher re-reads it, because there is nothing to lose. */}
      {editor.diskChange && (
        <ExternalChangeStrip
          fileName={file.name}
          onReload={editor.reloadFromDisk}
          onKeepMine={editor.keepMineAgainstDisk}
        />
      )}

      {/* Find/replace, as a ROW under the header rather than a floating card: the
          desktop bar is 330px wide, and on a 390px screen a floating card would cover
          the very lines it is searching. `FindWidget` is absolutely positioned in its
          own stylesheet, so it is wrapped in a `relative` box that owns its own row. */}
      {find.open && !byteViewer && (
        <div className="relative shrink-0 h-9 border-b border-ink/10 bg-paper">
          <FindWidget find={find} />
        </div>
      )}

      {/* Which surface draws this file — see `EditorSurface.tsx` for the dispatch
          and why the code surface is never wrapped in a scroller. */}
      <MobileEditorSurface
        file={file}
        editor={editor}
        viewerKind={viewerKind}
        byteViewer={byteViewer}
        isPreview={isPreview}
        isMd={isMd}
        content={content}
        language={lang}
        wordWrap={wordWrap}
        fileKey={fileKey}
        revealMarks={revealMarks}
        currentMark={currentMark}
        surfaceRef={surfaceRef}
        setCodeScroller={setCodeScroller}
        previewRef={previewRef}
        scroll={scroll}
        fontSize={fontSize}
        reviewActive={hasReview && review.active}
        onExitReview={review.toggle}
        editorTheme={editorTheme}
        editorFontFamily={editorFontFamily}
        indentUnitText={indentUnitFor(editorIndent)}
        typing={editorTyping}
      />

      {/* The outline is a floating control rather than a panel section: on a
          phone the drawer and this editor are separate screens, so a section
          pinned to the drawer's floor would have no editor to jump into. Same
          shape as the chat's "jump to your message" button — a tap-sized round
          target over the content, list in a sheet. Hidden for a byte viewer,
          which has no text to outline. */}
      {!byteViewer && (
        <MobileOutlineButton
          path={file.path ?? null}
          symbols={outlineSymbols}
          total={outlineTotal}
          truncated={outlineTruncated}
          emptyNotice={outlineNotice}
          preview={isMd && isPreview}
        />
      )}

      <EditorStatusBar
        isImage={editor.isImage}
        byteViewer={byteViewer}
        viewerKind={viewerKind}
        lineCount={linesCount}
        charCount={content.length}
        language={lang}
        saveStatus={editor.saveStatus}
        path={file.path}
        conflicts={conflicts}
      />

      {editor.saveMissingConfirm && file.path && (
        <SaveDeletedFileModal
          fileName={file.name}
          filePath={file.path}
          onClose={editor.cancelSaveMissing}
          onConfirm={editor.confirmSaveMissing}
        />
      )}

    </div>
  );
}
