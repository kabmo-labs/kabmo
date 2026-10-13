import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSessionUiState } from '@/client/hooks/workspace/session-state';
import { parseUnifiedDiff } from '@/shared/lib/fs/diff-parser';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { DiffToolbar, type DiffContentMode, type DiffViewMode } from '@/client/components/workspace/diff-panel/Toolbar';
import { UnifiedView } from '@/client/components/workspace/diff-panel/UnifiedView';
import { SplitView } from '@/client/components/workspace/diff-panel/SplitView';
import { usePluginDiffView } from '@/client/components/workspace/editor/plugin-file-view';
import { PluginIdProvider } from '@ompchamber/ui';
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
}: DiffPanelProps) {
  // Read and persist view mode & whitespace preference in session_ui_state
  const [viewMode, setViewMode] = useSessionUiState<DiffViewMode>('diff.viewMode', 'unified');
  const [contentMode, setContentMode] = useSessionUiState<DiffContentMode>('diff.contentMode', 'diff');
  const [wordWrap, setWordWrap] = useSessionUiState<boolean>('diff.wordWrap', true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useSessionUiState<boolean>('diff.ignoreWhitespace', false);

  const [rawDiff, setRawDiff] = useState<string>('');
  const [currentStatus, setCurrentStatus] = useState<string>(status);
  const [currentStaged, setCurrentStaged] = useState<boolean>(isStaged);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);

  /**
   * The staged flag / status the next fetch must ask for. The state copies lag
   * a click by a render, and keeping them in `fetchDiff`'s dependency list made
   * every response re-key the callback and fire another fetch. Refs keep the
   * callback stable and always read the post-action value.
   */
  const stagedRef = useRef<boolean>(isStaged);
  const statusRef = useRef<string>(status);
  const fetchSeqRef = useRef(0);

  const fetchDiff = useCallback(async (overrides: { staged?: boolean; status?: string } = {}) => {
    if (!filePath) return;
    const seq = ++fetchSeqRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const staged = overrides.staged ?? stagedRef.current;
      const statusForFetch = overrides.status ?? statusRef.current;
      const params = new URLSearchParams({
        fileDiff: '1',
        file: filePath,
        staged: staged ? '1' : '0',
        repo: repo || '.',
      });
      // `fullContext=1` makes git emit the whole file rather than the hunks.
      // Only the user's own toggle changes it, so it is safe as a callback
      // dependency (unlike the staged/status copies above, which the action
      // path updates while a fetch of its own is already in flight).
      if (contentMode === 'full') params.set('fullContext', '1');
      if (statusForFetch) params.set('status', statusForFetch);
      if (root) params.set('root', root);

      const res = await fetch(`/api/fs/git?${params.toString()}`);
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        diff?: string;
        status?: string;
        staged?: boolean;
        error?: string;
      } | null;
      // A slower earlier read must not overwrite a newer one (the action path
      // fires a fetch of its own while the initial one is still in flight).
      if (seq !== fetchSeqRef.current) return;
      if (data?.success) {
        setRawDiff(data.diff || '');
        if (data.status) {
          statusRef.current = data.status;
          setCurrentStatus(data.status);
        }
        if (typeof data.staged === 'boolean') {
          stagedRef.current = data.staged;
          setCurrentStaged(data.staged);
        }
      } else {
        setErrorMessage(data?.error || `Failed to load file diff (HTTP ${res.status})`);
      }
    } catch (err: unknown) {
      if (seq !== fetchSeqRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : 'Error fetching diff');
    } finally {
      if (seq === fetchSeqRef.current) setIsLoading(false);
    }
  }, [filePath, repo, root, contentMode]);

  useEffect(() => {
    setCurrentStatus(status);
    setCurrentStaged(isStaged);
    stagedRef.current = isStaged;
    statusRef.current = status;
  }, [status, isStaged, filePath]);

  useEffect(() => {
    void fetchDiff();
  }, [fetchDiff]);

  // Full-code mode parses the whole file, not the hunks, so the parse is keyed
  // to its inputs: every render used to re-walk the diff (measured 21 ms on an
  // 80k-line file), for a result that only changes when the diff or the
  // whitespace toggle does.
  // Only the rendered view is built: `views` keeps the shared flush (so the
  // whitespace decision and the counts cannot diverge) while skipping the
  // object graph nobody draws.
  const parsed = useMemo(
    () => parseUnifiedDiff(rawDiff, { ignoreWhitespace, views: viewMode === 'split' ? 'split' : 'unified' }),
    [rawDiff, ignoreWhitespace, viewMode],
  );
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
      () => setActionError('Clipboard write was refused by the browser'),
    );
  };

  /**
   * POST one git action and report whether it landed. The panel used to fire
   * and forget (`fetcher.submit` + an optimistic flip + a 300ms timer), which
   * made a rejected action indistinguishable from a successful one: the badge
   * flipped and the diff silently stayed put.
   */
  const runGitAction = useCallback(
    async (fields: Record<string, string>): Promise<boolean> => {
      const fd = new FormData();
      for (const [key, value] of Object.entries(fields)) fd.set(key, value);
      fd.set('repo', repo || '.');
      if (root) fd.set('root', root);
      try {
        const res = await fetch('/api/fs/git', { method: 'POST', body: fd });
        const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || !data?.success) {
          setActionError(data?.error || `Request failed (HTTP ${res.status})`);
          return false;
        }
        setActionError(null);
        return true;
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Request failed');
        return false;
      }
    },
    [repo, root],
  );

  const handleStageUnstage = async () => {
    if (isBusy) return;
    const nextStaged = !currentStaged;
    setIsBusy(true);
    try {
      const ok = await runGitAction({
        actionType: currentStaged ? 'unstage' : 'stage',
        file: filePath,
      });
      if (!ok) return;
      stagedRef.current = nextStaged;
      setCurrentStaged(nextStaged);
      onFileSaved?.();
      await fetchDiff({ staged: nextStaged });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDiscard = () => {
    setShowDiscardConfirm(true);
  };

  const confirmDiscard = async () => {
    setShowDiscardConfirm(false);
    setIsBusy(true);
    try {
      // `revert` is the server's own name for "restore this file from the index",
      // and it is the one that handles the untracked case (there the file is
      // removed). Sending `discard` — which no handler matched — returned
      // `{success:true}` for doing nothing at all.
      const ok = await runGitAction({ actionType: 'revert', file: filePath });
      if (!ok) return;
      onFileSaved?.();
      await fetchDiff();
    } finally {
      setIsBusy(false);
    }
  };

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
        additions={parsed.additions}
        deletions={parsed.deletions}
        isLoading={isLoading}
        isCopied={isCopied}
        isBusy={isBusy}
        onSetViewMode={handleSetViewMode}
        onSetContentMode={handleSetContentMode}
        onToggleWordWrap={handleToggleWordWrap}
        onToggleWhitespace={handleToggleWhitespace}
        onStageUnstage={handleStageUnstage}
        onDiscard={handleDiscard}
        onOpenInEditor={onOpenInEditor}
        onRefresh={() => void fetchDiff()}
        onCopyDiff={handleCopyDiff}
      />

      {actionError && (
        <div className="flex items-center gap-2 border-b border-error/25 bg-error/10 px-3 py-1.5 text-[11px] text-error flex-shrink-0">
          <AlertCircle size={13} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={actionError}>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
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
        ) : viewMode === 'split' ? (
          <SplitView rows={parsed.splitRows} language={language} wordWrap={wordWrap} />
        ) : (
          <UnifiedView lines={parsed.lines} language={language} wordWrap={wordWrap} />
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
                onClick={() => void confirmDiscard()}
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
