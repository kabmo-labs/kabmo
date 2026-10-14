import type { RefObject } from 'preact';
import { AlertTriangle, FileX, Loader2 } from 'lucide-preact';
import { EditorToolbar } from '@/client/components/workspace/editor/Toolbar';
import { FileDocument } from '@/client/components/workspace/editor/FileDocument';
import { PluginFileViewBody, type ResolvedPluginFileView } from '@/client/components/workspace/editor/plugin-file-view';
import { ImageViewer } from '@/client/components/common/image-viewer';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import type { UseFileEditorResult } from '@/client/hooks/editor/use-file-editor';
import type { EditorFindState } from '@/client/hooks/editor/use-editor-find';
import type { TextRange } from '@/shared/lib/code/editor/commands';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import { EDITOR_MAX_FONT_SIZE, EDITOR_MIN_FONT_SIZE } from '@/shared/lib/code/editor/typography';
import type { OpenedFile } from '@/shared/types/fs';

interface FilePaneProps {
  activeFile: OpenedFile;
  editor: UseFileEditorResult;
  find: EditorFindState;
  surfaceRef: RefObject<CodeSurfaceHandle>;
  /** The plugin view for this file, or null when none claims it. */
  pluginFileView: ResolvedPluginFileView | null;
  wordWrap: boolean;
  setWordWrap: (next: boolean) => void;
  isMd: boolean;
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
  /** A search hit was jumped to in this file, so its matches are painted. */
  revealActive: boolean;
  /** The file this tab names is gone from disk (see `useMissingFiles`). */
  missing: boolean;
}

/**
 * One plain (non-diff) file tab's body: the toolbar, then whichever surface the
 * file needs — the image viewer, a load state, a plugin's view, or the editor
 * document.
 *
 * Extracted from `Editor` because the panel crossed the repository's per-file
 * line ceiling once the tab strip had to be told which files were deleted. The
 * split is by CONCERN, not by size: everything here is about drawing the active
 * file, while the panel above owns the tab strip, the session-level state and
 * the keyboard dispatch.
 */
export function FilePane({
  activeFile,
  editor,
  find,
  surfaceRef,
  pluginFileView,
  wordWrap,
  setWordWrap,
  isMd,
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
}: FilePaneProps) {
  return (
    <>
      <EditorToolbar
        path={activeFile.path}
        saveStatus={editor.saveStatus}
        wordWrap={wordWrap}
        isMd={isMd}
        isPreview={isPreview}
        copied={editor.copied}
        isImage={editor.isImage}
        saveDisabled={Boolean(editor.loadError) || editor.handleMissing}
        unsupported={Boolean(editor.unsupported)}
        handleMissing={editor.handleMissing}
        isMaximized={isMaximized}
        findOpen={find.open}
        onToggleFind={() => (find.open ? find.close() : find.openFind())}
        onSave={editor.saveNow}
        onTogglePreview={togglePreview}
        onToggleWordWrap={() => setWordWrap(!wordWrap)}
        onZoomIn={() => setZoomLevel((z) => Math.min(EDITOR_MAX_FONT_SIZE, z + 1))}
        onZoomOut={() => setZoomLevel((z) => Math.max(EDITOR_MIN_FONT_SIZE, z - 1))}
        onCopy={editor.copy}
        onDownload={editor.download}
        onToggleMaximize={() => setIsMaximized(!isMaximized)}
      />

      {/* The tab strip says a deleted file is gone, but it is a small target in
          a crowded row — the banner states the same fact where the user is
          looking, and names the one thing that is still possible. */}
      {missing && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-error/30 bg-error/10 text-error">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[11.5px] font-sans">This file was deleted from disk.</div>
            <div className="text-[11px] font-sans text-error/80">
              The buffer is still here. Saving recreates the file — autosave is off until then.
            </div>
          </div>
        </div>
      )}

      {/* A launched file's handle dies with the page, so after a reload the tab
          can read and edit but cannot write. Saying so is the whole point: the
          Save button is disabled, and a user who is not told why would read it
          as a broken file. */}
      {editor.handleMissing && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-warning/30 bg-warning/10 text-warning">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[11.5px] font-sans">This file was opened by the system, not from a workspace.</div>
            <div className="text-[11px] font-sans text-warning/80">
              Its write permission ended with the last page load. Reopen the file from the OS to edit it again.
            </div>
          </div>
        </div>
      )}

      {editor.isImage && editor.imageUrl ? (
        // The picture owns its own pan/zoom, so it must NOT sit inside the
        // scrolling text container — a wheel there would scroll the pane
        // instead of zooming the image.
        <ImageViewer src={editor.imageUrl} name={activeFile.name} className="flex-1 min-h-0" />
      ) : editor.isLoading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-ink/40 text-xs font-mono">
          <Loader2 size={14} className="animate-spin" />
          <span>Loading file content…</span>
        </div>
      ) : editor.unsupported ? (
        // The server refused this file for its KIND, which is not the same fact
        // as a read that failed — saying "Could not read" over a zip describes a
        // problem the file does not have. Save is disabled for the same reason
        // it is after any failed read (an empty buffer), which the toolbar's own
        // title states.
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <FileX size={20} className="text-ink/40" />
          <span className="text-xs text-ink/70 font-sans">{activeFile.name} cannot be opened here</span>
          <span className="text-[11px] text-ink/50 font-sans max-w-[42ch]">{editor.unsupported}</span>
        </div>
      ) : editor.loadError ? (
        // A read that failed must say so. Without this the pane rendered an
        // empty (or substituted) buffer, and the next save wrote it over the
        // real file.
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <AlertTriangle size={20} className="text-error" />
          <span className="text-xs text-error font-sans">Could not read {activeFile.name}</span>
          <span className="text-[11px] text-ink/50 font-mono break-all">{editor.loadError}</span>
        </div>
      ) : pluginFileView && !editor.isImage ? (
        <PluginFileViewBody view={pluginFileView} />
      ) : (
        <FileDocument
          activeFile={activeFile}
          editor={editor}
          find={find}
          surfaceRef={surfaceRef}
          paletteOpen={paletteOpen}
          onClosePalette={() => setPaletteOpen(false)}
          onRunCommand={runCommand}
          wordWrap={wordWrap}
          zoomLevel={zoomLevel}
          editorFontFamily={editorFontFamily}
          occurrences={occurrences}
          onOccurrencesChange={setOccurrences}
          isPreview={isPreview}
          revealActive={revealActive}
        />
      )}
    </>
  );
}
