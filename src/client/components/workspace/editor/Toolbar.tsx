import { AlertCircle, Check, Copy, Download, Eye, EyeOff, Maximize, Minimize, Save, Search, WrapText, ZoomIn, ZoomOut } from 'lucide-preact';

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

  return (
    // `@container`: the path below hides on a NARROW PANEL, not a narrow
    // viewport. At the editor panel's 320px floor the action strip is 273px of
    // `flex-shrink-0`, which left the path a measured 23px — a truncated
    // fragment of a filename is not information, and the tab above already
    // carries it.
    <div className="@container flex items-center justify-between px-3 py-2 border-b border-ink/10 bg-paper flex-shrink-0">
      {/* Left status */}
      <div className="hidden @[420px]:flex items-center space-x-2 text-xs font-mono text-ink/40 min-w-0">
        <span className="truncate max-w-[300px]" title={path}>{path}</span>
      </div>

      {/* Right actions. `ml-auto` keeps them right-aligned once the path block
          above is hidden, which `justify-between` alone would not do (a single
          child sits at the start). */}
      <div className="flex items-center space-x-1 text-ink/40 flex-shrink-0 ml-auto">
        {!byteViewer && (
          <div className="flex items-center pr-2 mr-1 border-r border-ink/10">
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
          </div>
        )}

        {hasPreview && (
          <div className="flex items-center pr-2 mr-1 border-r border-ink/10">
            <button
              type="button"
              onClick={onTogglePreview}
              className={`${ACTION_CLASS} hover:bg-ink/5 ${isPreview ? 'text-ink' : 'hover:text-ink'}`}
              title={isPreview ? 'Show source' : 'Show preview'}
              aria-label={isPreview ? 'Show source' : 'Show preview'}
              aria-pressed={isPreview}
            >
              {isPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        )}

        {!byteViewer && (
          <>
            <div className="flex items-center pr-2 mr-1 border-r border-ink/10">
              <button
                type="button"
                onClick={onToggleFind}
                className={`${ACTION_CLASS} hover:bg-ink/5 ${findOpen ? 'text-ink' : 'hover:text-ink'}`}
                title="Find and replace (Ctrl+F)"
                aria-label="Find and replace"
                aria-pressed={findOpen}
              >
                <Search size={14} />
              </button>
            </div>

            <div className="flex items-center pr-2 mr-1 border-r border-ink/10">
              <button
                type="button"
                onClick={onToggleWordWrap}
                className={`${ACTION_CLASS} hover:bg-ink/5 ${wordWrap ? 'text-ink' : 'hover:text-ink'}`}
                title={wordWrap ? 'Word wrap on' : 'Word wrap off'}
                aria-label={wordWrap ? 'Word wrap on' : 'Word wrap off'}
                aria-pressed={wordWrap}
              >
                <WrapText size={14} />
              </button>
            </div>

            <div className="flex items-center pr-2 mr-1 border-r border-ink/10">
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
            </div>
          </>
        )}

        <div className="flex items-center pr-2 mr-1 border-r border-ink/10">
          <button
            type="button"
            onClick={onCopy}
            className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
            title={copied ? 'Copied' : byteViewer ? 'Copy image' : 'Copy content'}
            aria-label={copied ? 'Copied' : byteViewer ? 'Copy image' : 'Copy content'}
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
            title="Download file"
            aria-label="Download file"
          >
            <Download size={14} />
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleMaximize}
          className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink ${isMaximized ? 'text-ink' : ''}`}
          title={isMaximized ? 'Exit full screen' : 'Full screen'}
          aria-label={isMaximized ? 'Exit full screen' : 'Full screen'}
          aria-pressed={isMaximized}
        >
          {isMaximized ? <Minimize size={14} /> : <Maximize size={14} />}
        </button>
      </div>
    </div>
  );
}
