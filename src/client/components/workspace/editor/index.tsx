import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { EditorTabs } from '@/client/components/workspace/editor/Tabs';
import { EDITOR_KEY_BINDINGS, isFindBarCommand, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { EDITOR_DEFAULT_FONT_SIZE } from '@/shared/lib/code/editor/typography';
import { useEditorFontStack } from '@/client/hooks/editor/font';
import { useEditorTheme } from '@/client/hooks/editor/theme';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { resolveBinding } from '@/shared/lib/ui/key-binding';
import { useActiveEditorPanel } from '@/client/components/workspace/plugin-panel/resolve';
import { EditorBody } from '@/client/components/workspace/editor/Body';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';
import { SaveDeletedFileModal } from '@/client/components/workspace/editor/SaveDeletedFileModal';
import { usePluginFileView } from '@/client/components/workspace/editor/plugin-file-view';
import { RENDERED_VIEWERS, viewerKindFor } from '@/shared/lib/fs/document-kind';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { useFileEditor } from '@/client/hooks/editor/use-file-editor';
import { useEditorFind } from '@/client/hooks/editor/use-editor-find';
import { useSearchRevealTarget } from '@/client/hooks/editor/use-search-reveal';
import { useEditorOutlineBridge } from '@/client/hooks/editor/use-editor-outline-bridge';
import { useMissingFiles } from '@/client/hooks/workspace/missing-files';
import type { OpenedFile } from '@/shared/types/fs';

interface EditorProps {
  className?: string;
  openedFiles: OpenedFile[];
  activeFileId: number | string | null;
  onSelectFile: (id: number | string) => void;
  onCloseFile: (id: number | string) => void;
  /** Replace a diff tab with the plain editor tab for the same file. */
  onConvertDiffToEditor: (id: number | string) => void;
  refreshKey?: number;
  onFileSaved?: () => void;
  /**
   * A `plugin:<id>` key while a plugin owns the column, or null.
   *
   * There is no tab for it: the plugin takes the WHOLE surface, so the host has
   * no tab strip to draw and no file to show beside it. That is the difference
   * between a `panel` and an editor tab — the column is a place a view can live,
   * not a container the host fills with chrome.
   */
  activeEditorPanelKey?: string | null;
}

export function Editor({ 
  className = '', 
  openedFiles, 
  activeFileId, 
  onSelectFile, 
  onCloseFile, 
  onConvertDiffToEditor,
  refreshKey = 0,
  onFileSaved,
  activeEditorPanelKey = null,
}: EditorProps) {
  const activeFile = openedFiles.find(f => f.id === activeFileId);
  
  const [previewMode, setPreviewMode, previewReady] = useSessionState<Record<string | number, boolean>>('editor.previewMode', {});
  const [zoomLevel, setZoomLevel] = useSessionState<number>('editor.zoomLevel', EDITOR_DEFAULT_FONT_SIZE);
  const [isMaximized, setIsMaximized] = useState(false);
  const [wordWrap, setWordWrap] = useSessionState<boolean>('editor.wordWrap', true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { sessionId } = useSessionStateContext();
  const surfaceRef = useRef<CodeSurfaceHandle | null>(null);
  const editorFontFamily = useEditorFontStack();
  const editorTheme = useEditorTheme();

  // A deleted file keeps its tab (its buffer is still on screen), but the tab
  // strip must say so. Only a plain FILE tab is probed: a diff tab's path names
  // a change rather than a document, and an attachment chip carries inline
  // `content` with no file behind its `path` at all — probing that name would
  // strike the chip through the moment it was opened.
  const missingIds = useMissingFiles(
    openedFiles.filter((file) => !file.isDiff && file.content === undefined),
    refreshKey,
  );
  const activeFileMissing = Boolean(activeFile && missingIds.has(activeFile.id));

  const editor = useFileEditor(activeFile ?? null, {
    // A file that could not be read must report the failure, not substitute
    // placeholder text — the mock sample used to be written straight over the
    // real file by the next save.
    reportSaveError: true,
    onFileSaved,
    // The write path needs to know: a Save on a deleted file must ask first, and
    // a debounced autosave must not recreate it at all.
    missing: activeFileMissing,
  });

  // Resolved unconditionally: hooks cannot live in the branch that draws the
  // view, and the resolver is cheap when no plugin contributed one.
  const pluginFileView = usePluginFileView({ path: activeFile?.path ?? '', content: editor.content, language: editor.language });

  const find = useEditorFind({
    text: editor.content,
    documentKey: `${activeFile?.id ?? ''}\u0000${editor.language}`,
    readSelection: () => surfaceRef.current?.getSelection() ?? null,
    select: (start, end, focus = true) => surfaceRef.current?.select(start, end, focus),
    reveal: (offset) => surfaceRef.current?.revealOffset(offset),
    applyDocument: (value, caretStart, caretEnd) => surfaceRef.current?.applyDocument(value, caretStart, caretEnd),
    toggleWordWrap: () => setWordWrap((previous) => !previous),
  });

  // A search row's hand-off: the request names a line in THIS file, and the
  // find bar is opened on the same query so every occurrence is highlighted and
  // the caret lands on the hit. Served once the buffer is trustworthy — a file
  // still loading, or one whose read failed, has no text to match against.
  const searchReveal = useSearchRevealTarget(
    activeFile?.path ?? null,
    editor.content,
    editor.loaded && !editor.loadError,
  );
  // The resolved target is recomputed on every edit (the marks track the live
  // buffer), but the JUMP must fire once per request: keying the effect on the
  // target would drag the view back to the match after every keystroke.
  const firedRequestRef = useRef<unknown>(null);
  const revealMatchRef = useRef(find.revealMatch);
  revealMatchRef.current = find.revealMatch;
  useEffect(() => {
    if (!searchReveal || firedRequestRef.current === searchReveal.request) return;
    firedRequestRef.current = searchReveal.request;
    revealMatchRef.current({
      query: searchReveal.request.query,
      options: searchReveal.request.options,
      line: searchReveal.request.line,
    });
  }, [searchReveal]);
  // The capture handler below is rebuilt on every render anyway (it reads the
  // find state), so it is kept in a ref and the listener attached once.
  const findRef = useRef(find);
  findRef.current = find;

  /**
   * Publish what this editor is drawing (for the Files panel's outline), and
   * serve an outline row's jump: caret on the line, scrolled into view, NO find
   * bar. See `use-line-jump.ts` for the four rules the jump encodes.
   */
  useEditorOutlineBridge({
    file: activeFile,
    editor,
    surfaceRef,
    isPreview: activeFile ? previewMode[activeFile.id] === true : false,
    exitPreview: () => {
      const id = activeFile?.id;
      if (id === undefined || id === null) return;
      setPreviewMode(prev => ({ ...prev, [id]: false }));
    },
  });

  useEffect(() => {
    if (refreshKey > 0) editor.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    editor.retain(openedFiles.map(f => f.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedFiles]);

  useEffect(() => {
    if (!previewReady) return;
    const id = activeFile?.id;
    if (!activeFile || id === undefined || id === null) return;
    // Only a file with a RENDERED view has a default worth setting; a code file
    // has no preview to open. The default is ON (the picture/grid/prose is what
    // the user opened the file to read), which is why this seeds `true` — and
    // only when nothing was stored, so a user who switched to source keeps it.
    if (!RENDERED_VIEWERS[viewerKindFor(activeFile.name)] ) return;
    const stored = getSessionValue<Record<string | number, boolean>>(sessionId, 'editor.previewMode');
    if (stored && stored[id] !== undefined) return;
    setPreviewMode(prev => (prev[id] === undefined ? { ...prev, [id]: true } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewReady, activeFile]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        editor.saveNow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.saveNow]);

  const togglePreview = () => {
    if (!activeFile) return;
    setPreviewMode(prev => ({ ...prev, [activeFile.id]: !prev[activeFile.id] }));
  };

  /**
   * The one place a command runs, whatever asked for it — a chord, a toolbar
   * button or the palette. Splitting this by source is how a command ends up
   * working from the keyboard but not from the palette (or the reverse).
   */
  const runCommand = (command: EditorCommand) => {
    if (isFindBarCommand(command)) {
      findRef.current.runCommand(command);
      return;
    }
    if (command === 'toggleWordWrap') {
      setWordWrap((previous) => !previous);
      return;
    }
    // Everything else is the editor's, and it runs through the editor's own
    // dispatcher — the palette is a second way IN, never a second implementation.
    surfaceRef.current?.runCommand(command);
  };

  /**
   * Editor shortcuts, on the CAPTURE phase of the panel.
   *
   * Capture is what makes them work while focus is inside the document: the
   * contenteditable has CodeMirror's own handlers (the generated keymap, and
   * `defaultKeymap` behind it) and would otherwise see these first. Only the
   * commands the PANEL owns are consumed here — the editor's own keymap runs in
   * the document, where it has the buffer and the caret in hand.
   *
   * The panel is the scope, not the window: another panel's text field keeps
   * its own ⌘F, and the composer is untouched.
   */
  const handlePanelKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    const current = findRef.current;
    if (event.key === 'Escape') {
      if (paletteOpen) {
        event.preventDefault();
        event.stopPropagation();
        setPaletteOpen(false);
        return;
      }
      if (!current.open) return;
      event.preventDefault();
      event.stopPropagation();
      current.close();
      return;
    }
    // ⌘⇧P opens the palette — the one chord that is not an editor command.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyP') {
      event.preventDefault();
      event.stopPropagation();
      setPaletteOpen(true);
      return;
    }
    // While the bar is open, an unmodified key in one of ITS fields belongs to
    // the field — but F3 and the ⌘-chords below still dispatch, so stepping to
    // the next match from inside the find field works.
    const command = resolveBinding(EDITOR_KEY_BINDINGS, event);
    if (!command || !isFindBarCommand(command)) return;
    event.preventDefault();
    event.stopPropagation();
    runCommand(command);
  };

  // The column belongs to a plugin while the layout says so. There is no tab
  // strip in that mode: the plugin owns the whole surface, the way a right-panel
  // view does, and the layout's own toggle is what gives the column back.
  const pluginColumn = useActiveEditorPanel(activeEditorPanelKey);

  if (pluginColumn) {
    return (
      <div className={`flex flex-col h-full bg-canvas ${className}`}>
        <PluginIdProvider pluginId={pluginColumn.pluginId}>
          <pluginColumn.Component sessionId={sessionId ?? null} workspacePath={null} />
        </PluginIdProvider>
      </div>
    );
  }


  if (openedFiles.length === 0) {
    return (
      <div className={`flex flex-col h-full bg-canvas items-center justify-center text-ink/40 ${className}`}>
        <FileIcon name="placeholder.txt" size={48} className="mb-4 opacity-20" />
        <p className="font-mono text-sm">Select a file to open</p>
      </div>
    );
  }

  const viewerKind = editor.viewerKind;
  const isPreview = activeFile ? previewMode[activeFile.id] : false;

  const editorContainerClass = isMaximized 
    ? 'fixed inset-0 z-50 flex flex-col bg-canvas' 
    : `flex flex-col h-full bg-canvas ${className}`;

  return (
    <div className={editorContainerClass} onKeyDownCapture={handlePanelKeyDown}>
      <EditorTabs
        openedFiles={openedFiles}
        activeFileId={activeFileId}
        onSelectFile={onSelectFile}
        onCloseFile={onCloseFile}
        missingIds={missingIds}
      />

      <EditorBody
        activeFile={activeFile}
        editor={editor}
        find={find}
        surfaceRef={surfaceRef}
        pluginFileView={pluginFileView}
        wordWrap={wordWrap}
        setWordWrap={setWordWrap}
        viewerKind={viewerKind}
        isPreview={Boolean(isPreview)}
        isMaximized={isMaximized}
        setIsMaximized={setIsMaximized}
        zoomLevel={zoomLevel}
        setZoomLevel={setZoomLevel}
        paletteOpen={paletteOpen}
        setPaletteOpen={setPaletteOpen}
        runCommand={runCommand}
        editorFontFamily={editorFontFamily}
        editorTheme={editorTheme}
        togglePreview={togglePreview}
        revealActive={Boolean(searchReveal)}
        missing={activeFileMissing}
        onConvertDiffToEditor={onConvertDiffToEditor}
        onFileSaved={onFileSaved}
      />

      {/* Owned here, not by the pane: switching tabs must not close a question
          the user has not answered. The modal names the file it will recreate. */}
      {editor.saveMissingConfirm && activeFile && (
        <SaveDeletedFileModal
          fileName={activeFile.name}
          filePath={activeFile.path}
          onClose={editor.cancelSaveMissing}
          onConfirm={editor.confirmSaveMissing}
        />
      )}
    </div>
  );
}
