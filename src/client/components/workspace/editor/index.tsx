import { useEffect, useRef, useState } from 'preact/hooks';
import { EditorTabs } from '@/client/components/workspace/editor/Tabs';
import { isFindBarCommand, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { EDITOR_DEFAULT_FONT_SIZE } from '@/shared/lib/code/editor/typography';
import { useEditorFontStack } from '@/client/hooks/editor/font';
import { useEditorTheme } from '@/client/hooks/editor/theme';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { useActiveEditorPanel } from '@/client/components/workspace/plugin-panel/resolve';
import { EditorBody } from '@/client/components/workspace/editor/Body';
import { PluginColumn } from '@/client/components/workspace/editor/PluginColumn';
import { EmptyEditor } from '@/client/components/workspace/editor/EmptyEditor';

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
import { EditorPane } from '@/client/components/workspace/editor/Pane';
import { SplitColumn } from '@/client/components/workspace/editor/SplitColumn';
import { useSplitEditor } from '@/client/hooks/editor/use-split-editor';
import { useExternalChangeNotice } from '@/client/hooks/editor/use-external-change-notice';
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
  forcedActiveFileId = null,
  asSplitPane = false,
}: EditorProps) {
  // A split pane renders the tab it was given; the left pane follows the strip's active id.
  const resolvedActiveFileId = asSplitPane ? forcedActiveFileId : activeFileId;
  const activeFile = openedFiles.find(f => f.id === resolvedActiveFileId);

  const [previewMode, setPreviewMode, previewReady] = useSessionState<Record<string | number, boolean>>('editor.previewMode', {});
  const [zoomLevel, setZoomLevel] = useSessionState<number>('editor.zoomLevel', EDITOR_DEFAULT_FONT_SIZE);
  const [isMaximized, setIsMaximized] = useState(false);
  const [wordWrap, setWordWrap] = useSessionState<boolean>('editor.wordWrap', true);
  // The panel's own transient UI: the palette, the go-to-line request, quick open and Save
  // As. All four are component state (never persisted) because each is a thing the user is
  // doing right now.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // A counter, not a boolean: the dialog lives in the document (where the caret and the
  // handle are), so a boolean would need a matching "closed" write from there.
  const [goToLineRequest, setGoToLineRequest] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const { sessionId } = useSessionStateContext();
  // The split's state and its derived values. `enabled: false` in a split pane, which never
  // splits again — the column has two panes, not a tree.
  const splitState = useSplitEditor({
    openedFiles,
    activeFileId: resolvedActiveFileId,
    enabled: !asSplitPane,
  });
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

  // The disk-change strip and its answer; the rules live in the hook.
  const { externalChange, keepMine: keepMineAgainstDisk } = useExternalChangeNotice({
    file: activeFile,
    baseMtimeMs: editor.baseMtimeMs,
    dirty: editor.isDirty,
    revision: refreshKey,
    adoptDiskMtime: editor.adoptDiskMtime,
  });

  // Built after the editor: the guard writes through `editor.saveNow`.
  const closeGuard = useCloseGuard({
    openedFiles,
    activeFileId: resolvedActiveFileId,
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
    return <PluginColumn pluginId={pluginColumn.pluginId} Component={pluginColumn.Component} sessionId={sessionId} className={className} />;
  }

  if (openedFiles.length === 0) return <EmptyEditor className={className} />;

  const viewerKind = editor.viewerKind;
  const isPreview = activeFile ? previewMode[activeFile.id] : false;

  // A spread rather than twenty inline props: the split renders this same panel twice, and
  // two hand-written lists are how one pane gains a prop the other lacks.
  const bodyProps = {
    activeFile,
    editor,
    find,
    surfaceRef,
    pluginFileView,
    wordWrap,
    setWordWrap,
    viewerKind,
    isPreview: Boolean(isPreview),
    isMaximized,
    setIsMaximized,
    zoomLevel,
    setZoomLevel,
    paletteOpen,
    setPaletteOpen,
    goToLineRequest,
    onSaveAs: () => setSaveAsOpen(true),
    quickOpen,
    onCloseQuickOpen: () => setQuickOpen(false),
    onOpenPath,
    rootPath,
    repoPath,
    runCommand,
    editorFontFamily,
    editorTheme,
    togglePreview,
    revealActive: Boolean(searchReveal),
    missing: activeFileMissing,
    onConvertDiffToEditor,
    onFileSaved,
  };


  // The right pane IS this panel, so its props are this component's own. A record rather
  // than a literal: a hand-written list is where a second pane silently loses a feature.
  const panePropsForRightPane = (forcedActiveFileId: number | string) => ({
    openedFiles,
    activeFileId,
    onSelectFile,
    onCloseFile,
    onConvertDiffToEditor,
    refreshKey,
    onFileSaved,
    onOpenPath,
    rootPath,
    repoPath,
    forcedActiveFileId,
    asSplitPane: true,
  });

  // The strip, as one value: it is the LEFT pane's alone, and `EditorPane` drops it in a
  // split pane (the tab order belongs to one owner).
  const tabs = (
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
      onSplitTo={splitState.splitTo}
      onUnsplit={splitState.close}
      splitRightFileId={splitState.rightFile?.id ?? null}
    />
  );

  const paneBody = (
    <EditorPane
      className={className}
      isMaximized={isMaximized}
      onKeyDownCapture={panelKeys.onKeyDownCapture}
      asSplitPane={asSplitPane}
      tabs={tabs}
      activeFile={activeFile}
      editor={editor}
      externalChange={externalChange}
      conflict={editor.conflict}
      onReload={editor.resolveConflictByReload}
      onKeepMine={keepMineAgainstDisk}
      body={<EditorBody {...bodyProps} />}
      saveAsOpen={saveAsOpen}
      onSaveAsClose={() => setSaveAsOpen(false)}
      onSavedAs={(path) => {
        setSaveAsOpen(false);
        // The new file gets its OWN tab and the original stays open, which is what makes
        // Save As reversible by closing one tab.
        onOpenPath?.(path);
      }}
      closeGuard={closeGuard}
    />
  );

  if (!splitState.rightFile) return paneBody;

  return (
    <SplitColumn
      fraction={splitState.fraction}
      onFraction={splitState.setFraction}
      rightPaneName={splitState.rightFile.name}
      onClosePane={splitState.close}
      rightPane={<Editor {...panePropsForRightPane(splitState.rightFile.id)} />}
    >
      {paneBody}
    </SplitColumn>
  );
}
