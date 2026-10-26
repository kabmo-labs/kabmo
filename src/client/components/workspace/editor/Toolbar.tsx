import {
  AlertCircle,
  Check,
  Maximize,
  Minimize,
  Save,
} from 'lucide-preact';
import { EditorViewButtons, useEditorViewActions } from '@/client/components/common/editor-view-buttons';
import { ToolbarRow } from '@/client/components/common/toolbar-row';
import { ACTION_CLASS, buildEditorClusters } from '@/client/components/workspace/editor/toolbar-clusters';

export type EditorSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'needs-permission';

interface EditorToolbarProps {
  path: string;
  saveStatus: EditorSaveStatus;
  wordWrap: boolean;
  /**
   * The file has a rendered form (markdown prose, a CSV grid, an SVG picture),
   * so the eye toggle is offered. Named for the CONTRACT rather than for one
   * kind: the button used to be markdown-only, and a second `isMd`-shaped flag
   * per new preview is how the toolbar drifts from the pane.
   */
  hasPreview: boolean;
  isPreview: boolean;
  /** True for the 1.5s after a copy landed, so the button can confirm it. */
  copied: boolean;
  /**
   * A byte-drawing viewer (image, PDF, DOCX, workbook): no text buffer, so no
   * Save, find, wrap or font zoom — the picture/grid owns its own scale.
   */
  byteViewer?: boolean;
  /** A read failure left no trustworthy buffer, so there is nothing to save. */
  saveDisabled?: boolean;
  /**
   * The refusal was about the file's KIND rather than a failed read, so the
   * save title names that instead of blaming the read.
   */
  unsupported?: boolean;
  /**
   * A launched file whose write permission ended with the page load. Named
   * separately from the other two: the file is fine, the CAPABILITY is gone.
   */
  handleMissing?: boolean;
  isMaximized?: boolean;
  /** Find/replace is open — the button reflects it and toggles the bar. */
  findOpen?: boolean;
  onToggleFind: () => void;
  onSave: () => void;
  onTogglePreview: () => void;
  onToggleWordWrap: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCopy: () => void;
  onDownload: () => void;
  /**
   * Throw the buffer away and take the file from disk.
   *
   * Destructive, so it is never pinned and never in the row: a mis-click on a
   * toolbar of icon-only buttons must not be able to lose an edit.
   */
  onRevert: () => void;
  /** Enabled only for a buffer with edits — reverting a clean one does nothing. */
  canRevert: boolean;
  onToggleMaximize: () => void;
}

/**
 * The editor's toolbar: one row of clusters, with the overflow rule in
 * `toolbar-clusters.tsx`.
 *
 * This component owns the STATUS each control draws (the save icon's four faces,
 * the copy confirmation) and the labels they carry; the cluster table owns what
 * exists, in which order, and what a narrow panel must not bury. Splitting it
 * there is what keeps this file under the repository's line ceiling as controls
 * are added.
 */
export function EditorToolbar({
  path,
  saveStatus,
  wordWrap,
  hasPreview,
  isPreview,
  copied,
  byteViewer = false,
  saveDisabled = false,
  unsupported = false,
  handleMissing = false,
  isMaximized = false,
  findOpen = false,
  onToggleFind,
  onSave,
  onTogglePreview,
  onToggleWordWrap,
  onZoomIn,
  onZoomOut,
  onCopy,
  onDownload,
  onRevert,
  canRevert,
  onToggleMaximize,
}: EditorToolbarProps) {
  const saveTitle =
    saveDisabled
      ? handleMissing
        ? 'Cannot save — reopen the file from the system to restore write access'
        : unsupported
          ? 'Nothing to save — this file cannot be opened as a document'
          : 'Nothing to save — this file could not be read'
      : saveStatus === 'needs-permission'
        ? 'Click Save to allow writing this file'
        : saveStatus === 'saving'
          ? 'Saving…'
          : saveStatus === 'error'
            ? 'Save failed — the file on disk was not changed'
            : 'Save file (Ctrl+S)';

  const saveButton = (
    <button
      type="button"
      onClick={onSave}
      disabled={saveDisabled || saveStatus === 'saving'}
      className={`${ACTION_CLASS} hover:bg-ink/5`}
      title={saveTitle}
      aria-label={saveTitle}
    >
      {saveStatus === 'saving' ? (
        <Save size={14} className="text-amber-500 animate-pulse" />
      ) : saveStatus === 'saved' ? (
        <Check size={14} className="text-success" />
      ) : saveStatus === 'error' ? (
        <AlertCircle size={14} className="text-error" />
      ) : saveStatus === 'needs-permission' ? (
        // Not an error: the buffer is fine and one click grants access.
        <Save size={14} className="text-warning" />
      ) : (
        <Save size={14} className="hover:text-ink" />
      )}
    </button>
  );

  const maximizeLabel = isMaximized ? 'Exit full screen' : 'Full screen';
  const maximizeButton = (
    <button
      type="button"
      onClick={onToggleMaximize}
      className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink ${isMaximized ? 'text-ink' : ''}`}
      title={maximizeLabel}
      aria-label={maximizeLabel}
      aria-pressed={isMaximized}
    >
      {isMaximized ? <Minimize size={14} /> : <Maximize size={14} />}
    </button>
  );

  const viewModeActions = useEditorViewActions();
  const clusters = buildEditorClusters({
    byteViewer,
    hasPreview,
    isPreview,
    wordWrap,
    findOpen,
    copied,
    isMaximized,
    saveDisabled,
    canRevert,
    saveButton,
    maximizeButton,
    viewModeButtons: <EditorViewButtons size={14} />,
    viewModeActions,
    previewLabel: isPreview ? 'Show source' : 'Show preview',
    findLabel: 'Find and replace',
    wordWrapLabel: wordWrap ? 'Word wrap on' : 'Word wrap off',
    copyLabel: copied ? 'Copied' : byteViewer ? 'Copy image' : 'Copy content',
    maximizeLabel,
    onTogglePreview,
    onToggleFind,
    onToggleWordWrap,
    onZoomIn,
    onZoomOut,
    onCopy,
    onDownload,
    onRevert,
    onToggleMaximize,
    onSave,
  });

  return (
    // `@container`: the path below hides on a NARROW PANEL, not a narrow
    // viewport. At the editor panel's 320px floor the path would be a truncated
    // fragment of a filename — not information, and the tab above already
    // carries it.
    <div className="@container flex items-center justify-between gap-2 px-3 py-2 border-b border-ink/10 bg-paper flex-shrink-0">
      {/* Left status */}
      <div className="hidden @[420px]:flex items-center space-x-2 text-xs font-mono text-ink/40 min-w-0">
        <span className="truncate max-w-[300px]" title={path}>{path}</span>
      </div>

      {/* One row, never two: what does not fit moves into `⋯` (see
          `ToolbarRow`). A wrapped toolbar pushed the document down by its own
          height and read as a second toolbar. */}
      <ToolbarRow clusters={clusters} className="text-ink/40 ml-auto" />
    </div>
  );
}
