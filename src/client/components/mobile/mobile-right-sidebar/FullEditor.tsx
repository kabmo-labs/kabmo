import { useEffect, useRef, useState } from 'preact/hooks';
import { AlertTriangle, FileX, Loader2 } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { CodeSurface, type CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { ImageViewer } from '@/client/components/common/image-viewer';
import { EditorHeader } from '@/client/components/mobile/mobile-right-sidebar/Header';
import { SaveDeletedFileModal } from '@/client/components/workspace/editor/SaveDeletedFileModal';
import { EditorStatusBar } from '@/client/components/mobile/mobile-right-sidebar/StatusBar';
import { EditorDropOverlay } from '@/client/components/workspace/editor/EditorDropOverlay';
import { useEditorDrop } from '@/client/hooks/editor/use-editor-drop';
import { useScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import { useFileEditor } from '@/client/hooks/editor/use-file-editor';
import { useSearchRevealTarget } from '@/client/hooks/editor/use-search-reveal';
import { useEditorOutlineBridge } from '@/client/hooks/editor/use-editor-outline-bridge';
import { MobileOutlineButton } from '@/client/components/mobile/mobile-right-sidebar/OutlineButton';
import { useOutlineView } from '@/client/hooks/editor/use-outline-view';
import {
  EDITOR_DEFAULT_FONT_SIZE,
  EDITOR_LINE_HEIGHT,
  EDITOR_MAX_FONT_SIZE,
  EDITOR_MIN_FONT_SIZE,
} from '@/shared/lib/code/editor/typography';
import { useEditorFontStack } from '@/client/hooks/editor/font';
import { useEditorTheme } from '@/client/hooks/editor/theme';
import { MOBILE_SCROLL_POSITIONS_KEY } from '@/shared/lib/workspace/scroll-positions';
import { ViewerSurface, hasViewerSurface } from '@/client/components/workspace/editor/viewers/dispatch';
import { BINARY_VIEWERS, RENDERED_VIEWERS, VIEWER_LABELS, viewerKindFor } from '@/shared/lib/fs/document-kind';
import type { MobileEditorFile } from '@/client/components/mobile/open-file-payload';

interface MobileFullEditorProps {
  file: MobileEditorFile;
  onClose: () => void;
  /** The file this editor names is gone from disk. */
  missing?: boolean;
  /** Fired after a debounced write lands, so the workspace panels can refresh. */
  onFileSaved?: () => void;
  /** The outcome of a file dropped on this editor, for the host's toast stack. */
  onDropResult?: (result: { ok: boolean; message: string }) => void;
}

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

  // A search row on the phone opens this full-screen editor, so the hand-off
  // has to be served here too: the matched ranges are painted, and the caret is
  // placed on the hit once the buffer is on screen.
  const reveal = useSearchRevealTarget(
    file.path ?? null,
    editor.content,
    editor.loaded && !editor.loadError,
  );
  const surfaceRef = useRef<CodeSurfaceHandle | null>(null);
  const revealMarks = reveal && reveal.matches.length > 0 ? reveal.matches : undefined;
  const currentMark = reveal?.currentIndex ?? -1;
  const firedRef = useRef<unknown>(null);
  useEffect(() => {
    if (!reveal || firedRef.current === reveal.request) return;
    firedRef.current = reveal.request;
    const match = reveal.matches[reveal.currentIndex];
    if (!match) return;
    surfaceRef.current?.select(match.start, match.end, false);
    surfaceRef.current?.revealOffset(match.start);
  }, [reveal]);

  const content = editor.content;
  const lang = editor.language;
  const linesCount = content.split('\n').length;

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
        onToggleWrap={() => setWordWrap(!wordWrap)}
        onZoomOut={() => setFontSize(prev => Math.max(EDITOR_MIN_FONT_SIZE, prev - 1))}
        onZoomIn={() => setFontSize(prev => Math.min(EDITOR_MAX_FONT_SIZE, prev + 1))}
        onCopy={editor.copy}
        onDownload={editor.download}
      />

      {/* A deleted file: the buffer is still on screen and still editable, so
          the state has to be stated where the user is looking, and the Save
          that recreates it has to be confirmed. Same rule as the desktop pane. */}
      {missing && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-error/30 bg-error/10 text-error shrink-0">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[11.5px] font-sans">This file was deleted from disk.</div>
            <div className="text-[11px] font-sans text-error/80">
              The buffer is still here. Saving recreates the file — autosave is off until then.
            </div>
          </div>
        </div>
      )}

      {/* Editor Content Area - Desktop styled: bg-paper text-ink. An image owns
          its own pan/zoom, so it replaces the scrolling text container rather
          than living inside it; the same is true of every other byte viewer and
          of the rendered text views (a CSV grid, an SVG picture). */}
      {editor.isImage && editor.imageUrl ? (
        <ImageViewer src={editor.imageUrl} name={file.name} className="flex-1 min-h-0" />
      ) : editor.isImage ? (
        <ViewerSurface
          kind="image"
          path={file.path ?? file.name}
          name={file.name}
          source={editor.byteSource}
          content={editor.content}
          revision={editor.revision}
        />
      ) : hasViewerSurface(viewerKind) && (byteViewer || isPreview) ? (
        <ViewerSurface
          kind={viewerKind}
          path={file.path ?? file.name}
          name={file.name}
          source={editor.byteSource}
          content={editor.content}
          revision={editor.revision}
        />
      ) : editor.isLoading || editor.unsupported || editor.loadError || (isMd && isPreview) ? (
        // The states that draw their own scrolling content — and the markdown
        // preview, which is a document, not an editor — share one scroller.
        <div
          ref={scroll.ref}
          onScroll={scroll.onScroll}
          className="flex-1 min-h-0 overflow-auto relative bg-paper text-ink select-text"
        >
          {editor.isLoading ? (
            <div className="flex items-center justify-center h-full text-ink/40 text-xs gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading file content...</span>
            </div>
          ) : editor.unsupported ? (
            // Same distinction the desktop pane draws: a file refused for its
            // KIND was not a failed read, and saying so is the whole point.
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <FileX size={20} className="text-ink/40" />
              <span className="text-xs text-ink/70 font-sans">{file.name} cannot be opened here</span>
              <span className="text-[11px] text-ink/50 font-sans max-w-[42ch]">{editor.unsupported}</span>
            </div>
          ) : editor.loadError ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
              <AlertTriangle size={20} className="text-error" />
              <span className="text-xs text-error font-sans">Could not read {file.name}</span>
              <span className="text-[11px] text-ink/50 font-mono break-all">{editor.loadError}</span>
            </div>
          ) : (
            /* Markdown Preview Mode — styled by `.prose-content` (the chat
               timeline's system), see the desktop editor for why there is no
               `prose` wrapper. */
            <div className="p-4 bg-paper text-ink min-h-full font-sans" style={{ fontSize: `${fontSize}px` }}>
              <MarkdownRenderer
                content={content}
                document
                scope={{ path: file.path ?? file.name, root: file.root, repo: file.repo }}
              />
            </div>
          )}
        </div>
      ) : (
        /* The code surface owns its own scroller (CodeMirror's), so it is NOT
           wrapped in one: an outer `overflow-auto` resolves the editor's
           `height: 100%` against an auto-height box, so the editor grew to the
           document's full height and the panel had nothing to scroll. */
        <CodeSurface
          ref={surfaceRef}
          value={content}
          onValueChange={editor.onChange}
          language={lang}
          wordWrap={wordWrap}
          documentKey={fileKey}
          marks={revealMarks}
          currentMark={currentMark}
          onScroller={setCodeScroller}
          scrollTestId="editor-scroller"
          // No `bg-paper`: an explicit editor theme paints its own surface, and
          // the panel's colour under it would be a border of the wrong shade.
          // `select-text` is the desktop pane's rule, and it matters more here:
          // the sheet's own root is `select-none` (it is a header-and-status
          // layout), and the editor is now a `contenteditable` whose selection
          // and caret are the BROWSER's business — an inherited `user-select:
          // none` is the one thing that can take that away on a phone.
          className="flex-1 min-h-0 text-ink select-text"
          themeVars={editorTheme.vars}
          themes={editorTheme.themes}
          padding={12}
          style={{
            fontFamily: editorFontFamily,
            fontSize: `${fontSize}px`,
            lineHeight: EDITOR_LINE_HEIGHT,
          }}
        />
      )}

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
