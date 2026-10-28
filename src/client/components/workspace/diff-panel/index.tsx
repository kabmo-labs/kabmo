import { useCallback, useRef, useState } from 'preact/hooks';
import { useSessionUiState } from '@/client/hooks/workspace/session-state';
import { isUnmergedCode } from '@/shared/lib/fs/git-unmerged';
import { useFileDiff } from '@/client/hooks/workspace/diff-file';
import { useDiffGitActions } from '@/client/hooks/workspace/diff-git-actions';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { DiffToolbar, type DiffContentMode, type DiffViewMode } from '@/client/components/workspace/diff-panel/Toolbar';
import { ConflictBanner } from '@/client/components/workspace/diff-panel/ConflictBanner';
import { ThemedMergeDiffView } from '@/client/components/workspace/diff-panel/ThemedMergeDiffView';
import { useEditorFontStack } from '@/client/hooks/editor/font';
import { EDITOR_DEFAULT_FONT_SIZE } from '@/shared/lib/code/editor/typography';
import { usePluginDiffView } from '@/client/components/workspace/editor/plugin-file-view';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';
import { AlertCircle, RefreshCw } from 'lucide-preact';

interface DiffPanelProps {
  filePath: string;
  status?: string;
  isStaged?: boolean;
  root?: string;
  repo?: string;
  onOpenInEditor?: () => void;
  onFileSaved?: () => void;
  className?: string;
  /**
   * The tab this diff belongs to, so the reader's scroll offset is remembered
   * per tab (and per view shape). Null for a host with no tab of its own.
   */
  tabKey?: string | null;
  /**
   * Offer the two width-mode buttons. On by default (the editor column is where
   * they belong); the phone's full-screen overlay turns them off, because it
   * already covers the chat and the sidebar.
   */
  viewModeButtons?: boolean;
}

export function DiffPanel({
  filePath,
  status = 'M',
  isStaged = false,
  root,
  repo = '.',
  onOpenInEditor,
  onFileSaved,
  className = '',
  tabKey = null,
  viewModeButtons = true,
}: DiffPanelProps) {
  // Read and persist view mode & whitespace preference in session_ui_state
  const [viewMode, setViewMode] = useSessionUiState<DiffViewMode>('diff.viewMode', 'unified');
  const [contentMode, setContentMode] = useSessionUiState<DiffContentMode>('diff.contentMode', 'diff');
  const [wordWrap, setWordWrap] = useSessionUiState<boolean>('diff.wordWrap', true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useSessionUiState<boolean>('diff.ignoreWhitespace', false);

  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);
  /** Additions/deletions of the pair on screen, reported by the merge view. */
  const [counts, setCounts] = useState<{ additions: number; deletions: number }>({ additions: 0, deletions: 0 });
  /**
   * Which changed hunk the caret is in, reported by the merge view.
   *
   * The step command is held in a ref rather than state: it is a function the
   * toolbar calls, and putting it in state would re-render the panel every time
   * the view re-mounts (a shape switch) for a value nothing displays.
   */
  const [chunkPosition, setChunkPosition] = useState<{ index: number; count: number }>({ index: -1, count: 0 });
  const stepChunkRef = useRef<((direction: 1 | -1) => void) | null>(null);
  const handleStepChunk = useCallback((direction: 1 | -1) => {
    stepChunkRef.current?.(direction);
  }, []);
  const handleChunkCommand = useCallback((step: (direction: 1 | -1) => void) => {
    stepChunkRef.current = step;
  }, []);
  const editorFontFamily = useEditorFontStack();

  const {
    rawDiff,
    oldContent,
    newContent,
    currentStatus,
    currentStaged,
    isLoading,
    errorMessage,
    fetchDiff,
    adoptState,
  } = useFileDiff({ filePath, status, isStaged, repo, root });
  const conflicted = isUnmergedCode(currentStatus);

  const language = getLanguageFromPath(filePath);
  // A contributed renderer replaces the built-in views below, never the toolbar.
  const pluginDiffView = usePluginDiffView({ path: filePath, diff: rawDiff });

  const handleSetViewMode = (mode: DiffViewMode) => {
    setViewMode(mode);
  };

  const handleSetContentMode = (mode: DiffContentMode) => {
    setContentMode(mode);
  };

  const handleToggleWordWrap = () => {
    setWordWrap(!wordWrap);
  };

  const handleToggleWhitespace = () => {
    setIgnoreWhitespace(!ignoreWhitespace);
  };

  const handleCopyDiff = () => {
    if (!rawDiff) return;
    void navigator.clipboard.writeText(rawDiff).then(
      () => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      },
      () => setClipboardError('Clipboard write was refused by the browser'),
    );
  };

  /**
   * The git writes, their busy flag, their refusals, and the conflict-marker
   * read behind the banner — see `diff-git-actions.ts`. The one exception is
   * the clipboard, which is not a write: it reads the buffer already on screen
   * and must stay available while a write is in flight.
   */
  const gitActions = useDiffGitActions({
    filePath,
    repo,
    root,
    status: currentStatus,
    staged: currentStaged,
    conflicted,
    adoptState,
    fetchDiff,
    onFileSaved,
  });
  const { isBusy, markers } = gitActions;
  // Two refusal surfaces with one source: the clipboard's own failure is local
  // to this panel, while a git refusal comes from the server.
  const actionError = clipboardError ?? gitActions.error;

  return (
    // The panel fills, it does not size itself: the caller owns the height
    // (`flex-1` in the editor's column, `h-full` in the mobile overlay). A
    // hardcoded `h-full` here resolves against the whole editor column rather
    // than the space left under the tabs, so the panel began below the tabs
    // *and* stood the full column tall — its bottom, the toolbar's height,
    // hung past the panel edge and was clipped for good, since the scroll
    // range ends below the visible area.
    <div className={`flex flex-col min-h-0 bg-paper select-text relative font-sans ${className}`}>
      {/* Top Diff Toolbar */}
      <DiffToolbar
        filePath={filePath}
        status={currentStatus}
        isStaged={currentStaged}
        viewMode={viewMode}
        contentMode={contentMode}
        wordWrap={wordWrap}
        ignoreWhitespace={ignoreWhitespace}
        additions={counts.additions}
        deletions={counts.deletions}
        chunkIndex={chunkPosition.index}
        chunkCount={chunkPosition.count}
        onStepChunk={handleStepChunk}
        isLoading={isLoading}
        isCopied={isCopied}
        isBusy={isBusy}
        viewModeButtons={viewModeButtons}
        onSetViewMode={handleSetViewMode}
        onSetContentMode={handleSetContentMode}
        onToggleWordWrap={handleToggleWordWrap}
        onToggleWhitespace={handleToggleWhitespace}
        onStageUnstage={() => void gitActions.stageUnstage()}
        onDiscard={() => setShowDiscardConfirm(true)}
        onOpenInEditor={onOpenInEditor}
        onRefresh={() => void fetchDiff()}
        onCopyDiff={handleCopyDiff}
      />

      {conflicted && (
        <ConflictBanner
          markers={markers}
          isBusy={isBusy}
          error={actionError}
          onResolve={(side) => void gitActions.resolve(side)}
          onDismissError={() => {
            gitActions.dismissError();
            setClipboardError(null);
          }}
        />
      )}

      {actionError && !conflicted && (
        <div className="flex items-center gap-2 border-b border-error/25 bg-error/10 px-3 py-1.5 text-[11px] text-error flex-shrink-0">
          <AlertCircle size={13} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={actionError}>{actionError}</span>
          <button
            type="button"
            onClick={() => {
              gitActions.dismissError();
              setClipboardError(null);
            }}
            className="px-1.5 rounded hover:bg-error/15 cursor-pointer"
            title="Dismiss"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Diff Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col bg-paper">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center space-x-2 text-ink/50 text-xs font-mono">
            <RefreshCw size={14} className="animate-spin" />
            <span>Loading file diff...</span>
          </div>
        ) : errorMessage ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2">
            <AlertCircle size={20} className="text-error" />
            <p className="text-xs text-error font-medium">{errorMessage}</p>
            <button
              onClick={() => void fetchDiff()}
              className="px-3 py-1 text-xs bg-ink/10 hover:bg-ink/15 text-ink rounded font-sans transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : pluginDiffView ? (
          <PluginIdProvider pluginId={pluginDiffView.pluginId}>
            <pluginDiffView.Component {...pluginDiffView.props} />
          </PluginIdProvider>
        ) : (
          // Both shapes are the SAME component: `@codemirror/merge` owns the
          // diff and the rows, and a shape switch is a re-mount of a different
          // object (an `EditorView` vs a `MergeView`), which is why it is a prop
          // rather than a second component.
          <ThemedMergeDiffView
            original={oldContent}
            next={newContent}
            language={language}
            viewMode={viewMode}
            contentMode={contentMode}
            wordWrap={wordWrap}
            ignoreWhitespace={ignoreWhitespace}
            tabKey={tabKey}
            onCounts={setCounts}
            onChunkPosition={setChunkPosition}
            onStepChunk={handleChunkCommand}
            empty={!rawDiff || !rawDiff.trim()}
            fontFamily={editorFontFamily}
            fontSize={EDITOR_DEFAULT_FONT_SIZE}
          />
        )}
      </div>

      {/* Discard Confirmation Modal */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 bg-ink/20 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-paper rounded-lg shadow-xl p-4 w-full max-w-sm border border-ink/15">
            <h3 className="font-semibold text-ink mb-1.5 text-sm">Discard Changes?</h3>
            <p className="text-xs text-ink/70 mb-4">
              Are you sure you want to discard all unstaged changes in <span className="font-mono font-medium text-ink">{filePath}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3 py-1.5 text-xs text-ink hover:bg-ink/5 rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  void gitActions.revert();
                }}
                className="px-3 py-1.5 text-xs bg-error text-white rounded hover:bg-error/90 font-medium transition-colors cursor-pointer"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
