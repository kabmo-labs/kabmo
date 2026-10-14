import { DiffPanel } from '@/client/components/workspace/diff-panel';
import { FilePane } from '@/client/components/workspace/editor/FilePane';
import type { EditorFindState } from '@/client/hooks/editor/use-editor-find';
import type { UseFileEditorResult } from '@/client/hooks/editor/use-file-editor';
import type { ResolvedPluginFileView } from '@/client/components/workspace/editor/plugin-file-view';
import type { TextRange } from '@/shared/lib/code/editor/commands';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import type { RefObject } from 'preact';
import type { ViewerKind } from '@/shared/lib/fs/document-kind';
import type { OpenedFile } from '@/shared/types/fs';

interface EditorBodyProps {
  activeFile: OpenedFile | undefined;
  editor: UseFileEditorResult;
  find: EditorFindState;
  surfaceRef: RefObject<CodeSurfaceHandle>;
  pluginFileView: ResolvedPluginFileView | null;
  wordWrap: boolean;
  setWordWrap: (next: boolean) => void;
  /** The surface this file's kind is drawn by (see `document-kind`). */
  viewerKind: ViewerKind;
  isPreview: boolean;
  isMaximized: boolean;
  setIsMaximized: (next: boolean) => void;
  zoomLevel: number;
  setZoomLevel: (update: (current: number) => number) => void;
  occurrences: readonly TextRange[];
  setOccurrences: (next: readonly TextRange[]) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  runCommand: (command: EditorCommand) => void;
  editorFontFamily: string;
  togglePreview: () => void;
  revealActive: boolean;
  missing: boolean;
  onConvertDiffToEditor: (id: number | string) => void;
  onFileSaved?: () => void;
}

/**
 * The editor column's middle: the active tab's surface, or the empty notice.
 *
 * Extracted from the panel because the panel also owns the tab strip, the drop
 * target, the keyboard dispatch and the session-level state, and the two
 * surfaces below it (a diff and a file) are a whole branch each. The panel was
 * at the repository's per-file line ceiling once the drop target landed.
 */
export function EditorBody({
  activeFile,
  editor,
  find,
  surfaceRef,
  pluginFileView,
  wordWrap,
  setWordWrap,
  viewerKind,
  isPreview,
  isMaximized,
  setIsMaximized,
  zoomLevel,
  setZoomLevel,
  occurrences,
  setOccurrences,
  paletteOpen,
  setPaletteOpen,
  runCommand,
  editorFontFamily,
  togglePreview,
  revealActive,
  missing,
  onConvertDiffToEditor,
  onFileSaved,
}: EditorBodyProps) {
  if (!activeFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink/40">
        <p className="font-mono text-sm">Select a tab to view content</p>
      </div>
    );
  }

  if (activeFile.isDiff) {
    return (
      <DiffPanel
        filePath={activeFile.path}
        status={activeFile.diffStatus || 'M'}
        isStaged={Boolean(activeFile.diffStaged)}
        root={activeFile.root}
        repo={activeFile.repo || '.'}
        onOpenInEditor={() => onConvertDiffToEditor(activeFile.id)}
        onFileSaved={onFileSaved}
        className="flex-1"
      />
    );
  }

  return (
    <FilePane
      activeFile={activeFile}
      editor={editor}
      find={find}
      surfaceRef={surfaceRef}
      pluginFileView={pluginFileView}
      wordWrap={wordWrap}
      setWordWrap={setWordWrap}
      viewerKind={viewerKind}
      isPreview={isPreview}
      isMaximized={isMaximized}
      setIsMaximized={setIsMaximized}
      zoomLevel={zoomLevel}
      setZoomLevel={setZoomLevel}
      occurrences={occurrences}
      setOccurrences={setOccurrences}
      paletteOpen={paletteOpen}
      setPaletteOpen={setPaletteOpen}
      runCommand={runCommand}
      editorFontFamily={editorFontFamily}
      togglePreview={togglePreview}
      revealActive={revealActive}
      missing={missing}
    />
  );
}
