import { useEffect, useRef, useState } from 'preact/hooks';
import { FileIcon } from '@/client/components/common/file-icon';
import { EditorTabs } from '@/client/components/workspace/editor/Tabs';
import { isFindBarCommand, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { EDITOR_DEFAULT_FONT_SIZE } from '@/shared/lib/code/editor/typography';
import { useEditorFontStack } from '@/client/hooks/editor/font';
import { useEditorTheme } from '@/client/hooks/editor/theme';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { useActiveEditorPanel } from '@/client/components/workspace/plugin-panel/resolve';
import { EditorBody } from '@/client/components/workspace/editor/Body';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';

import { usePluginFileView } from '@/client/components/workspace/editor/plugin-file-view';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { useFileEditor } from '@/client/hooks/editor/use-file-editor';
import { useEditorFind } from '@/client/hooks/editor/use-editor-find';
import { useSearchRevealTarget } from '@/client/hooks/editor/use-search-reveal';
import { useSearchRevealJump } from '@/client/hooks/editor/use-search-reveal-jump';
import { useEditorTabState } from '@/client/hooks/editor/use-editor-tab-state';
import { useEditorOutlineBridge } from '@/client/hooks/editor/use-editor-outline-bridge';
import { useMissingFiles } from '@/client/hooks/workspace/missing-files';
import { retainDirtyTabs } from '@/client/lib/editor-dirty-tabs';
import { EditorDialogs } from '@/client/components/workspace/editor/Dialogs';
import { useExternalChange } from '@/client/hooks/editor/use-external-change';
import { EditorNotices } from '@/client/components/workspace/editor/Notices';
import { useEditorPanelKeys } from '@/client/hooks/editor/use-editor-panel-keys';
import { useCloseGuard } from '@/client/hooks/editor/use-close-guard';
import type { EditorProps } from '@/client/components/workspace/editor/props';

export function Editor({ 
  className = '', 
  openedFiles, 
  activeFileId, 
  onSelectFile, 
  onCloseFile, 
  onConvertDiffToEditor,
  refreshKey = 0,
  onFileSaved,
  onOpenPath,
  onReopenClosed,
  reopenableCount,
  onCopyPath,
  onRevealInFiles,
  rootPath = null,
  repoPath = null,
  activeEditorPanelKey = null,
}: EditorProps) {
  const activeFile = openedFiles.find(f => f.id === activeFileId);
  
  const [previewMode, setPreviewMode, previewReady] = useSessionState<Record<string | number, boolean>>('editor.previewMode', {});
  const [zoomLevel, setZoomLevel] = useSessionState<number>('editor.zoomLevel', EDITOR_DEFAULT_FONT_SIZE);
  const [isMaximized, setIsMaximized] = useState(false);
  const [wordWrap, setWordWrap] = useSessionState<boolean>('editor.wordWrap', true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // A counter, not a boolean: the dialog lives in the document (where the caret and
  // the handle are), so a boolean would need a matching "closed" write from there.
  const [goToLineRequest, setGoToLineRequest] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
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

  /**
   * "This file changed on disk while you were editing it."
   *
   * Only a DIRTY buffer asks — a clean one has nothing to lose, and the read effect
   * already re-reads on a refresh. `refreshKey` is the panel's own "something was
   * written" counter, so an agent's tool call, a Files-panel delete and a manual
   * Refresh all reach here without a poll.
   */
  const externalChange = useExternalChange({
    path: activeFile && !activeFile.isDiff ? activeFile.path : null,
    root: activeFile?.root,
    repo: activeFile?.repo,
    baseMtimeMs: editor.baseMtimeMs,
    dirty: editor.isDirty,
    revision: refreshKey,
  });

  /**
   * Closing a tab, guarded when it holds edits that are not on disk.
   *
   * Built after the editor because the guard writes through `editor.saveNow` — a
   * background tab is activated first, since `saveNow` writes the ACTIVE file.
   */
  /**
   * "Keep mine" on the external-change strip: adopt the disk mtime as this buffer's
   * base, so the next save is not refused over a change the user has now seen and
   * accepted. Nothing is written — the buffer stays dirty and the autosave owns the write.
   */
  const keepMineAgainstDisk = () => {
    const mtime = externalChange?.mtimeMs;
    if (mtime != null) editor.adoptDiskMtime(mtime);
  };

  const closeGuard = useCloseGuard({
    openedFiles,
    activeFileId,
    onSelectFile,
    onCloseFile,
    saveNow: editor.saveNow,
  });

  const find = useEditorFind({
    text: editor.content,
    documentKey: `${activeFile?.id ?? ''}\u0000${editor.language}`,
    readSelection: () => surfaceRef.current?.getSelection() ?? null,
    select: (start, end, focus = true) => surfaceRef.current?.select(start, end, focus),
    reveal: (offset) => surfaceRef.current?.revealOffset(offset),
    applyDocument: (value, caretStart, caretEnd) => surfaceRef.current?.applyDocument(value, caretStart, caretEnd),
    toggleWordWrap: () => setWordWrap((previous) => !previous),
  });

  // A search row's hand-off: open the bar on the same query and land the caret on
  // the hit. Owned by a hook because the "fire once per request" rule is subtle.
  const searchReveal = useSearchRevealTarget(
    activeFile?.path ?? null,
    editor.content,
    editor.loaded && !editor.loadError,
  );
  useSearchRevealJump({ searchReveal, revealMatch: find.revealMatch });

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
    // The dirty store follows the same lifecycle as the content cache: a tab that
    // left the strip must not keep an entry a later tab could inherit.
    retainDirtyTabs(openedFiles.map((file) => file.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedFiles]);

  // Publish which tabs hold unsaved edits (the strip's dot, the close guard, the
  // unload prompt) and seed the default preview mode for a rendered file.
  useEditorTabState({
    openedFiles,
    dirtyKeys: editor.dirtyKeys,
    activeFile,
    previewReady,
    setPreviewMode,
    sessionId,
  });

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
      find.runCommand(command);
      return;
    }
    if (command === 'toggleWordWrap') {
      setWordWrap((previous) => !previous);
      return;
    }
    if (command === 'goToLine') {
      setGoToLineRequest((previous) => previous + 1);
      return;
    }
    // Everything else is the editor's, and it runs through the editor's own
    // dispatcher — the palette is a second way IN, never a second implementation.
    surfaceRef.current?.runCommand(command);
  };

  const panelKeys = useEditorPanelKeys({
    find,
    paletteOpen,
    setPaletteOpen,
    runCommand,
    saveNow: editor.saveNow,
    openQuickOpen: () => setQuickOpen(true),
    reopenClosed: onReopenClosed,
  });

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
    <div className={editorContainerClass} onKeyDownCapture={panelKeys.onKeyDownCapture}>
      <EditorTabs
        openedFiles={openedFiles}
        activeFileId={activeFileId}
        onSelectFile={onSelectFile}
        onCloseFile={closeGuard.requestClose}
        missingIds={missingIds}
        onCopyPath={onCopyPath}
        onRevealInFiles={onRevealInFiles}
        onReopenClosed={onReopenClosed}
        reopenableCount={reopenableCount}
      />

      <EditorNotices
        activeFile={activeFile}
        externalChange={externalChange}
        conflict={editor.conflict}
        onReload={editor.resolveConflictByReload}
        onKeepMine={keepMineAgainstDisk}
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
        goToLineRequest={goToLineRequest}
        quickOpen={quickOpen}
        onCloseQuickOpen={() => setQuickOpen(false)}
        onOpenPath={onOpenPath}
        rootPath={rootPath}
        repoPath={repoPath}
        runCommand={runCommand}
        editorFontFamily={editorFontFamily}
        editorTheme={editorTheme}
        togglePreview={togglePreview}
        revealActive={Boolean(searchReveal)}
        missing={activeFileMissing}
        onConvertDiffToEditor={onConvertDiffToEditor}
        onFileSaved={onFileSaved}
      />

      <EditorDialogs
        closeGuard={closeGuard}
        activeFile={activeFile}
        saveMissingConfirm={editor.saveMissingConfirm}
        onCancelSaveMissing={editor.cancelSaveMissing}
        onConfirmSaveMissing={editor.confirmSaveMissing}
      />
    </div>
  );
}
