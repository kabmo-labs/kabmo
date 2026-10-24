import { AlignJustify, Check, Code2, Columns, Copy, Diff, FileCode, Minus, Plus, RefreshCw, Space, Undo2, WrapText } from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { EditorViewButtons, useEditorViewActions } from '@/client/components/common/editor-view-buttons';
import { getGitStatusInfo } from '@/shared/lib/fs/git-status';
import { ToolbarRow, type ToolbarCluster } from '@/client/components/common/toolbar-row';
import { DiffContentModeSegments, DiffViewModeSegments } from '@/client/components/workspace/diff-panel/ToolbarSegments';

export type DiffViewMode = 'unified' | 'split';

/**
 * How much of the file the diff shows. `diff` is the default: git's own
 * default context around the changed regions, which is what a reader wants
 * first. `full` shows the whole file with the changes marked inside it, for
 * when the hunks alone leave the edit without context.
 */
export type DiffContentMode = 'full' | 'diff';

interface DiffToolbarProps {
  filePath: string;
  status: string;
  isStaged: boolean;
  viewMode: DiffViewMode;
  contentMode: DiffContentMode;
  wordWrap: boolean;
  ignoreWhitespace: boolean;
  additions: number;
  deletions: number;
  isLoading: boolean;
  isCopied: boolean;
  /** A stage/unstage/discard write is in flight; the toolbar locks its actions. */
  isBusy?: boolean;
  /**
   * Offer the two WIDTH-mode buttons (compact / full view). Desktop-only: the
   * phone renders this same panel in a full-screen overlay, where there is no
   * chat column or sidebar beside it for a mode to widen into.
   */
  viewModeButtons?: boolean;
  onSetViewMode: (mode: DiffViewMode) => void;
  onSetContentMode: (mode: DiffContentMode) => void;
  onToggleWordWrap: () => void;
  onToggleWhitespace: () => void;
  onStageUnstage: () => void;
  onDiscard: () => void;
  onOpenInEditor?: () => void;
  onRefresh: () => void;
  onCopyDiff: () => void;
}

const ACTION_CLASS =
  'flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink/50';

export function DiffToolbar({
  filePath,
  status,
  isStaged,
  viewMode,
  contentMode,
  wordWrap,
  ignoreWhitespace,
  additions,
  deletions,
  isLoading,
  isCopied,
  isBusy = false,
  viewModeButtons = true,
  onSetViewMode,
  onSetContentMode,
  onToggleWordWrap,
  onToggleWhitespace,
  onStageUnstage,
  onDiscard,
  onOpenInEditor,
  onRefresh,
  onCopyDiff,
}: DiffToolbarProps) {
  const viewModeActions = useEditorViewActions();
  const fileName = filePath.split('/').pop() || filePath;
  const statusInfo = getGitStatusInfo(status, isStaged);
  // Only the actions that write to git lock while one is in flight. Copying the
  // diff is a local read of what is already on screen, so it stays available.
  const locked = isLoading || isBusy;

  const stageLabel = isStaged ? 'Unstage file' : 'Stage file';
  const wrapLabel = wordWrap ? 'Word wrap on' : 'Word wrap off';
  const whitespaceLabel = ignoreWhitespace ? 'Whitespace changes hidden' : 'Hide whitespace changes';
  const copyLabel = isCopied ? 'Copied' : 'Copy diff text';

  /**
   * The controls, as clusters that hide as a unit.
   *
   * ORDER is the visual order a reader looks for. PINNING says what a narrow
   * panel must not bury: the width modes (the reason these buttons exist), Stage
   * (the panel's primary write) and Edit File (the way out of the diff). The
   * reading options — Unified/Split, Full/Diff, wrap, whitespace — are what a
   * `⋯` menu is for; they change how the diff READS, not what it does.
   */
  const clusters: ToolbarCluster[] = [];

  if (additions > 0 || deletions > 0) {
    clusters.push({
      id: 'counts',
      // The only piece of the header that survives everywhere: the editor tab
      // carries the file name but never the counts.
      pinned: true,
      actions: [],
      children: (
        <div className="flex items-center space-x-1.5 text-[11px] font-mono pr-1.5 mr-0.5 @[440px]:mr-1 border-r border-ink/10">
          {additions > 0 && <span className="text-success font-semibold">+{additions}</span>}
          {deletions > 0 && <span className="text-error font-semibold">-{deletions}</span>}
        </div>
      ),
    });
  }

  clusters.push({
    id: 'view-mode',
    actions: [
      { label: 'Split (side-by-side) diff', icon: Columns, onSelect: () => onSetViewMode('split'), active: viewMode === 'split' },
      { label: 'Unified diff', icon: AlignJustify, onSelect: () => onSetViewMode('unified'), active: viewMode === 'unified' },
    ],
    children: <DiffViewModeSegments viewMode={viewMode} onSetViewMode={onSetViewMode} />,
  });

  clusters.push({
    id: 'content-mode',
    actions: [
      {
        label: 'Full code (whole file, changes marked)',
        icon: FileCode,
        onSelect: () => onSetContentMode('full'),
        active: contentMode === 'full',
      },
      { label: 'Diff only (changed hunks)', icon: Diff, onSelect: () => onSetContentMode('diff'), active: contentMode === 'diff' },
    ],
    children: <DiffContentModeSegments contentMode={contentMode} onSetContentMode={onSetContentMode} />,
  });

  clusters.push({
    id: 'wrap',
    actions: [{ label: wrapLabel, icon: WrapText, onSelect: onToggleWordWrap, active: wordWrap }],
    children: (
      <button
        type="button"
        onClick={onToggleWordWrap}
        className={`p-1.5 rounded transition-colors cursor-pointer flex-shrink-0 ${
          wordWrap ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink hover:bg-ink/5'
        }`}
        title={wrapLabel}
        aria-label={wrapLabel}
        aria-pressed={wordWrap}
      >
        <WrapText size={13} />
      </button>
    ),
  });

  clusters.push({
    id: 'whitespace',
    actions: [{ label: whitespaceLabel, icon: Space, onSelect: onToggleWhitespace, active: ignoreWhitespace }],
    children: (
      <button
        type="button"
        onClick={onToggleWhitespace}
        className={`p-1.5 rounded transition-colors cursor-pointer flex-shrink-0 ${
          ignoreWhitespace ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink hover:bg-ink/5'
        }`}
        title={whitespaceLabel}
        aria-label={whitespaceLabel}
        aria-pressed={ignoreWhitespace}
      >
        <Space size={13} />
      </button>
    ),
  });

  if (viewModeButtons) {
    clusters.push({
      id: 'view-modes',
      // The same two buttons the editor toolbar draws, in the same order, so a
      // mode entered from either tab kind is one mode.
      pinned: true,
      actions: viewModeActions,
      children: <EditorViewButtons size={13} />,
    });
  }

  clusters.push({
    id: 'refresh',
    actions: [{ label: 'Reload this diff', icon: RefreshCw, onSelect: onRefresh, disabled: locked }],
    children: (
      <button
        type="button"
        onClick={onRefresh}
        className={`${ACTION_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
        title="Reload this diff"
        aria-label="Reload this diff"
        disabled={locked}
      >
        <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
      </button>
    ),
  });

  clusters.push({
    id: 'copy',
    // Never disabled: it reads the buffer already on screen.
    actions: [{ label: copyLabel, icon: Copy, onSelect: onCopyDiff }],
    children: (
      <button
        type="button"
        onClick={onCopyDiff}
        className={`${ACTION_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
        title={copyLabel}
        aria-label={copyLabel}
      >
        {isCopied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
    ),
  });

  if (!isStaged) {
    clusters.push({
      id: 'discard',
      actions: [{ label: 'Discard changes in this file', icon: Undo2, onSelect: onDiscard, disabled: locked }],
      children: (
        <button
          type="button"
          onClick={onDiscard}
          className={`${ACTION_CLASS} text-ink/50 hover:text-error hover:bg-error/10`}
          title="Discard changes in this file"
          aria-label="Discard changes in this file"
          disabled={locked}
        >
          <Undo2 size={13} />
        </button>
      ),
    });
  }

  clusters.push({
    id: 'stage',
    // The panel's primary write: a menu row must not be the only way to stage.
    pinned: true,
    actions: [{ label: stageLabel, icon: isStaged ? Minus : Plus, onSelect: onStageUnstage, disabled: locked }],
    children: (
      <button
        type="button"
        onClick={onStageUnstage}
        className="px-2 py-1 text-[11px] font-medium rounded border border-ink/15 hover:bg-ink/5 flex items-center space-x-1 transition-colors text-ink cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        title={stageLabel}
        aria-label={stageLabel}
        disabled={locked}
      >
        {isStaged ? (
          <>
            <Minus size={12} />
            <span className="hidden @[360px]:inline">Unstage</span>
          </>
        ) : (
          <>
            <Plus size={12} />
            <span className="hidden @[360px]:inline">Stage</span>
          </>
        )}
      </button>
    ),
  });

  if (onOpenInEditor) {
    clusters.push({
      id: 'edit-file',
      // The way out of the diff, and the only control that changes the SURFACE
      // rather than the view: kept on the row.
      pinned: true,
      actions: [{ label: 'Open in code editor', icon: Code2, onSelect: onOpenInEditor }],
      children: (
        <button
          type="button"
          onClick={onOpenInEditor}
          className="px-2 py-1 text-[11px] font-medium rounded bg-ink text-canvas hover:bg-ink/90 flex items-center space-x-1 transition-colors shadow-xs ml-1 cursor-pointer"
          title="Open in code editor"
          aria-label="Open in code editor"
        >
          <Code2 size={12} />
          <span className="hidden @[360px]:inline">Edit File</span>
        </button>
      ),
    });
  }

  return (
    // `@container` so the labels below can hide on a NARROW PANEL rather than a
    // narrow viewport: the editor panel is 320px wide on a 1440px screen, and
    // `sm:` (viewport-keyed) kept every label on, overflowing the toolbar.
    <div className="@container flex items-center justify-between px-3 py-1.5 bg-paper border-b border-ink/10 text-xs font-sans select-none flex-shrink-0 gap-2 min-w-0">
      {/* Left: File name and status badge. Hidden when the panel is narrow —
          the editor tab already carries the name and the status character, and
          the mobile diff header carries both. */}
      <div className="hidden @[560px]:flex items-center space-x-2 min-w-0 pr-2">
        <FileIcon name={fileName} size={14} className="flex-shrink-0" />
        <span className="font-mono text-ink font-medium truncate" title={filePath}>
          {fileName}
        </span>

        <span className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border ${statusInfo.badgeBgClass} flex-shrink-0`}>
          {statusInfo.charStatus} {statusInfo.label}
        </span>
      </div>

      {/* Right: Controls & actions. ONE row, never two: what does not fit moves
          into `⋯` (see `ToolbarRow`), because a wrapped strip moved the diff
          down by its own height and read as a second toolbar, while the
          `overflow-x-auto` before that clipped the tail invisibly (measured:
          361px of content in a 296px box, `Stage` entirely outside it).
          Each segment SETS its own mode — a toggle would flip the other one. */}
      <ToolbarRow clusters={clusters} className="text-ink/70 ml-auto" />
    </div>
  );
}
