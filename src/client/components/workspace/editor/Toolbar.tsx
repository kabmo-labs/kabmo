import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  Save,
  Search,
  WrapText,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact';
import { EditorViewButtons, useEditorViewActions } from '@/client/components/common/editor-view-buttons';
import { ToolbarRow, type ToolbarCluster } from '@/client/components/common/toolbar-row';

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
  onToggleMaximize: () => void;
}

/**
 * Shared icon-button shell. Every action here is icon-only, so each one carries
 * a `title` (the tooltip) and an `aria-label` (the accessible name) — a bare
 * `<svg onClick>` is unreachable by keyboard and unlabeled to a screen reader.
 * `p-1.5` also gives the 14px glyph a ~26px hit target.
 */
const ACTION_CLASS =
  'flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50';

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

  const copyLabel = copied ? 'Copied' : byteViewer ? 'Copy image' : 'Copy content';
  const copyButton = (
    <button
      type="button"
      onClick={onCopy}
      className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
      title={copyLabel}
      aria-label={copyLabel}
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </button>
  );

  const downloadButton = (
    <button
      type="button"
      onClick={onDownload}
      className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
      title="Download file"
      aria-label="Download file"
    >
      <Download size={14} />
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
  const findLabel = 'Find and replace';
  const wordWrapLabel = wordWrap ? 'Word wrap on' : 'Word wrap off';
  const previewLabel = isPreview ? 'Show source' : 'Show preview';

  /**
   * The controls, as clusters that hide as a unit.
   *
   * ORDER is the hiding order, most important first: the row keeps the width
   * modes and full screen (the controls this panel is FOR), then copy/download,
   * and the reading aids (find, wrap, zoom, preview) move into the `⋯` menu on a
   * narrow panel. Grouping is the existing one — zoom is a pair, copy/download is
   * a pair, the modes are a pair — because splitting a pair leaves half of it on
   * the row.
   */
  const clusters: ToolbarCluster[] = [];

  if (!byteViewer) {
    clusters.push({
      id: 'save',
      // The primary action of the panel: a menu row must never be the only way
      // to save a file.
      pinned: true,
      actions: [{ label: 'Save file', icon: Save, onSelect: onSave, disabled: saveDisabled }],
      children: saveButton,
    });
  }
  if (hasPreview) {
    clusters.push({
      id: 'preview',
      actions: [{ label: previewLabel, icon: isPreview ? EyeOff : Eye, onSelect: onTogglePreview, active: isPreview }],
      children: (
        <button
          type="button"
          onClick={onTogglePreview}
          className={`${ACTION_CLASS} hover:bg-ink/5 ${isPreview ? 'text-ink' : 'hover:text-ink'}`}
          title={previewLabel}
          aria-label={previewLabel}
          aria-pressed={isPreview}
        >
          {isPreview ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      ),
    });
  }
  if (!byteViewer) {
    clusters.push({
      id: 'find',
      actions: [{ label: findLabel, icon: Search, onSelect: onToggleFind, active: findOpen }],
      children: (
        <button
          type="button"
          onClick={onToggleFind}
          className={`${ACTION_CLASS} hover:bg-ink/5 ${findOpen ? 'text-ink' : 'hover:text-ink'}`}
          title={`${findLabel} (Ctrl+F)`}
          aria-label={findLabel}
          aria-pressed={findOpen}
        >
          <Search size={14} />
        </button>
      ),
    });
    clusters.push({
      id: 'wrap',
      actions: [{ label: wordWrapLabel, icon: WrapText, onSelect: onToggleWordWrap, active: wordWrap }],
      children: (
        <button
          type="button"
          onClick={onToggleWordWrap}
          className={`${ACTION_CLASS} hover:bg-ink/5 ${wordWrap ? 'text-ink' : 'hover:text-ink'}`}
          title={wordWrapLabel}
          aria-label={wordWrapLabel}
          aria-pressed={wordWrap}
        >
          <WrapText size={14} />
        </button>
      ),
    });
    clusters.push({
      id: 'zoom',
      actions: [
        { label: 'Decrease font size', icon: ZoomOut, onSelect: onZoomOut },
        { label: 'Increase font size', icon: ZoomIn, onSelect: onZoomIn },
      ],
      children: (
        <>
          <button
            type="button"
            onClick={onZoomOut}
            className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
            title="Decrease font size"
            aria-label="Decrease font size"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
            title="Increase font size"
            aria-label="Increase font size"
          >
            <ZoomIn size={14} />
          </button>
        </>
      ),
    });
  }

  clusters.push({
    id: 'copy',
    actions: [
      { label: copyLabel, icon: Copy, onSelect: onCopy },
      { label: 'Download file', icon: Download, onSelect: onDownload },
    ],
    children: (
      <>
        {copyButton}
        {downloadButton}
      </>
    ),
  });

  // The width modes and full SCREEN are the controls this panel exists for, so
  // they are the LAST clusters — the tail is what the menu takes. Three controls
  // about one axis, three different glyphs: compact collapses the chat (a
  // crossed-out message), full collapses the chat and the sidebar (a closing
  // panel edge), and full screen covers the right panel too (a maximise frame).
  clusters.push({
    id: 'view-modes',
    // The two width modes are why this toolbar grew these buttons, and a mode
    // reachable only from a menu is a mode half the readers never find.
    pinned: true,
    actions: viewModeActions,
    children: <EditorViewButtons size={14} />,
  });
  clusters.push({
    id: 'maximize',
    pinned: true,
    actions: [{ label: maximizeLabel, icon: isMaximized ? Minimize : Maximize, onSelect: onToggleMaximize, active: isMaximized }],
    children: maximizeButton,
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
