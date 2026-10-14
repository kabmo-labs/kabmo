
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CommitHistoryPage } from '@/shared/types';
import { GitCommitBox } from '@/client/components/workspace/git-panel/CommitBox';
import { GitOperationBar } from '@/client/components/workspace/git-panel/OperationBar';
import { GitBranchToolbar } from '@/client/components/workspace/git-panel/BranchToolbar';
import { GitRepoHeader } from '@/client/components/workspace/git-panel/RepoHeader';
import { GitChangesList } from '@/client/components/workspace/git-panel/ChangesList';
import { GitPanelModals } from '@/client/components/workspace/git-panel/PanelModals';
import { GitStashSection } from '@/client/components/workspace/git-panel/StashSection';
import { ToastStack } from '@/client/components/common/ToastStack';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useGitPanelData } from '@/client/hooks/workspace/git-panel-data';
import { useGitActions } from '@/client/hooks/workspace/git-actions';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { isUnmergedCode } from '@/shared/lib/fs/git-unmerged';
import { confirmRequestFor } from '@/client/components/workspace/git-panel/confirm-request';
import type { ConfirmRequest } from '@/client/components/workspace/git-panel/confirm-request';

interface GitPanelProps {
  className?: string;
  enabled?: boolean;
  rootPath?: string;
  refreshKey?: number;
}

export function GitPanel({ className = '', enabled = true, rootPath, refreshKey = 0 }: GitPanelProps) {
  // The status read, the repo scope and the realtime topic — see
  // `useGitPanelData` for why the list and the ahead/behind badge take their
  // values from the topic while the HTTP read only refreshes the tracking ref.
  const {
    activeRepo,
    setActiveRepo,
    repos,
    reposScanning,
    refreshRepos,
    isReading,
    isRefreshing,
    data,
    syncCount,
    loadRepo,
    refreshTopic,
  } = useGitPanelData(rootPath, enabled, refreshKey);
  // Mutations (commit/stage/checkout/sync, and the history/graph reads) go
  // through their own fetcher: a user-started action disables the controls,
  // which is the one thing a topic push must not do.
  const actionFetcher = useGitActions(rootPath, activeRepo);

  const [message, setMessage] = useSessionState<string>('git.commitDraft', '');
  const [viewMode, setViewMode] = useSessionState<'flat' | 'tree'>('git.viewMode', 'flat');
  
  const [showOptions, setShowOptions] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);

  const [showRepoMenu, setShowRepoMenu] = useState(false);
  const repoRef = useRef<HTMLDivElement>(null);

  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const branchRef = useRef<HTMLDivElement>(null);

  // Custom modal states
  const [confirmModal, setConfirmModal] = useState<ConfirmRequest | null>(null);
  const [branchPrompt, setBranchPrompt] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const newBranchInputRef = useRef<HTMLInputElement>(null);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [amend, setAmend] = useSessionState<boolean>('git.amend', false);
  
  // History and Graph states
  const [viewingOutput, setViewingOutput] = useState<CommitHistoryPage | null>(null);
  const [mounted, setMounted] = useState(false);
  /**
   * The payload this effect has already acted on.
   *
   * `actionFetcher.data` is STICKY — it holds the last response for the life of
   * the mount — while `loadRepo` is a dependency whose identity changes whenever
   * `rootPath` does. Switching to a session in another workspace therefore
   * re-ran the effect against the PREVIOUS history payload and reopened a modal
   * the user had already dismissed, which is the reported "clicking a session
   * item opens the commit modal". Consuming each response exactly once is what
   * makes the modal open because the user ASKED for it and nothing else.
   */
  const consumedActionRef = useRef<unknown>(null);

  const { toasts, pushToast, dismissToast } = useToasts();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Focus input when branch prompt opens
  useEffect(() => {
    if (branchPrompt && newBranchInputRef.current) {
      newBranchInputRef.current.focus();
    }
  }, [branchPrompt]);

  // Reload after action completes. A response is acted on ONCE: the fetcher
  // keeps its last payload, so without the guard any later run of this effect
  // (a new `loadRepo` identity, a re-render) would re-open the commit modal the
  // user just closed.
  useEffect(() => {
    if (actionFetcher.state === 'idle' && actionFetcher.data) {
      const payload = actionFetcher.data;
      if (payload === consumedActionRef.current) return;
      consumedActionRef.current = payload;
      if (payload.type === 'history' || payload.type === 'graph') {
        // `hasMore` and `total` are part of the page, not decoration: without
        // them the modal cannot know the branch holds more than the 50 rows it
        // was handed, and the header reports the page size as the total.
        setViewingOutput({
          title: payload.type === 'graph' ? 'Git Graph' : 'Commit History',
          data: payload.data || [],
          hasMore: payload.hasMore,
          total: payload.total,
        });
      } else if (payload.success) {
        loadRepo();
      } else {
        pushToast(payload.error || 'Git operation failed');
      }
    }
  }, [actionFetcher.state, actionFetcher.data, loadRepo]);

  useOnClickOutside(optionsRef, () => setShowOptions(false));
  useOnClickOutside(repoRef, () => setShowRepoMenu(false));
  useOnClickOutside(branchRef, () => setShowBranchMenu(false));

  const executeAction = actionFetcher.execute;

  /**
   * Route one action through a confirmation when it is destructive.
   *
   * The set of confirming actions and their wording live in
   * `confirm-request.ts` — see there for why those four and only those four.
   */
  const handleAction = (actionType: string, file?: string, additionalData?: Record<string, string>) => {
    const request = confirmRequestFor(actionType, file, additionalData, data?.state?.operation ?? null);
    if (request) {
      setConfirmModal(request);
      return;
    }
    executeAction(actionType, file, additionalData);
  };

  /**
   * Resolve one conflicted path.
   *
   * A side (`ours`/`theirs`) writes that stage into the working tree and stages
   * it; `''` is "mark resolved", which is only the `git add` — the file was
   * edited by hand. The labels on the buttons come from the file's own conflict
   * markers, never from the words ours/theirs (see `GitConflictItem`).
   */
  const handleResolveConflict = (file: string, side: 'ours' | 'theirs' | '') => {
    executeAction('resolve_conflict', file, side ? { side } : undefined);
  };

  const commit = () => {
    executeAction('commit', undefined, { message, ...(amend ? { amend: '1' } : {}) });
    setMessage('');
    setAmend(false);
  };

  const branch = data?.branch || 'main';
  const branches = data?.branches || ['main'];
  const remoteBranches = data?.remoteBranches || [];
  const changes = data?.changes || [];
  // A mutation the user started (a fetch, a commit/stage action) disables the
  // controls; a topic PUSH must not, or a background tool call would lock the
  // commit box for a beat.
  const isBusy = isReading || actionFetcher.state !== 'idle';

  // Unmerged pairs are excluded for the same reason `GitChangesList` excludes
  // them: their two letters are the two SIDES of a conflict, so the column test
  // below would count every conflicted file as staged and enable a Commit that
  // git then refuses.
  const stagedChanges = changes.filter(c => {
    if (isUnmergedCode(c.status)) return false;
    const status = c.status;
    return status && status[0] !== ' ' && status[0] !== '?';
  });

  if (!enabled) {
    return (
      <div className={`flex flex-col h-full bg-paper items-center justify-center text-ink/40 ${className}`}>
        <span className="text-xs font-mono">No session selected</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-paper relative ${className}`}>
      <GitPanelModals
        mounted={mounted}
        confirmModal={confirmModal}
        onCloseConfirm={() => setConfirmModal(null)}
        onConfirm={() => {
          if (confirmModal) {
            executeAction(confirmModal.type, confirmModal.file, confirmModal.extra);
            setConfirmModal(null);
          }
        }}
        branchPrompt={branchPrompt}
        newBranchName={newBranchName}
        newBranchInputRef={newBranchInputRef}
        onNewBranchNameChange={setNewBranchName}
        onCloseBranchPrompt={() => {
          setBranchPrompt(false);
          setNewBranchName('');
        }}
        onCreateBranch={() => {
          if (newBranchName.trim()) {
            executeAction('create_branch', undefined, { branch: newBranchName.trim() });
            setBranchPrompt(false);
            setNewBranchName('');
          }
        }}
        viewingOutput={viewingOutput}
        onCloseOutput={() => setViewingOutput(null)}
        onRefreshOutput={() => {
          if (viewingOutput) {
            executeAction(viewingOutput.title.toLowerCase().includes('graph') ? 'graph' : 'history');
          }
        }}
        onExecuteAction={(actionType, file, extra) => executeAction(actionType, file, extra)}
        branchModalOpen={branchModalOpen}
        onCloseBranchModal={() => setBranchModalOpen(false)}
        rootPath={rootPath}
        activeRepo={activeRepo}
        currentBranch={branch}
        detached={data?.state?.detached ?? false}
        isBusy={isBusy}
        onBranchAction={(actionType, extra) => executeAction(actionType, undefined, extra)}
        onConfirmDeleteBranch={(name, force) => {
          // The modal's own `DeleteBranchDialog` IS the confirmation — it names
          // the branch, its last commit and its date, and carries the force
          // checkbox. Routing it through the panel's generic confirm modal too
          // asked the same question twice and dropped the force flag.
          executeAction('delete_branch', undefined, { branch: name, ...(force ? { force: '1' } : {}) });
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Repo Switcher Header */}
      <GitRepoHeader 
        repoRef={repoRef}
        showRepoMenu={showRepoMenu}
        setShowRepoMenu={setShowRepoMenu}
        activeRepo={activeRepo}
        repos={repos}
        isRefreshing={isRefreshing}
        rootPath={rootPath}
        reposScanning={reposScanning}
        onSelectRepo={(r) => {
          // The reload is the scope effect's job: it fires on the resolved
          // `activeRepo` change, so selecting here would fetch the same repo
          // twice.
          if (r !== activeRepo) setActiveRepo(r);
        }}
        onRefresh={() => {
          // The list comes from the TOPIC, so refreshing it is what updates the
          // change list; `loadRepo` is what refreshes the tracking ref and then
          // re-resolves the topic, so the count describes origin. Both, because
          // a repository that changed on disk (a terminal `git add`, an editor
          // save) needs the topic re-read while the badge needs the fetch.
          refreshTopic();
          loadRepo();
        }}
        onRefreshRepos={refreshRepos}
      />
      
      {/* Branch & View Mode Toolbar */}
      <GitBranchToolbar 
        branchRef={branchRef}
        showBranchMenu={showBranchMenu}
        setShowBranchMenu={setShowBranchMenu}
        branch={branch}
        branches={branches}
        remoteBranches={remoteBranches}
        onCheckout={(b: string) => executeAction('checkout', undefined, { branch: b })}
        onMerge={(b: string) => executeAction('merge_branch', undefined, { branch: b })}
        onOpenBranchPrompt={() => setBranchPrompt(true)}
        onManageBranches={() => { setBranchModalOpen(true); setShowBranchMenu(false); }}
        optionsRef={optionsRef}
        showOptions={showOptions}
        setShowOptions={setShowOptions}
        onHistory={() => executeAction('history')}
        onGraph={() => executeAction('graph')}
        viewMode={viewMode}
        setViewMode={setViewMode}
        isBusy={isBusy}
        syncCount={syncCount}
        onSync={() => executeAction('sync')}
        onFetch={() => executeAction('fetch')}
        detached={data?.state?.detached ?? false}
      />

      {/* While an operation is stopped, the operation bar takes the commit
          box's place: a merge cannot be committed through it (git refuses),
          and the two actions that exist only in that state live there. */}
      {data?.state?.operation ? (
        <GitOperationBar
          operation={data.state.operation}
          conflicts={data.state.conflicts}
          isBusy={isBusy}
          onAbort={() => handleAction('abort_operation')}
          onContinue={() => executeAction('continue_operation')}
        />
      ) : (
        <GitCommitBox 
          message={message}
          hasStagedChanges={stagedChanges.length > 0}
          isBusy={isBusy}
          amend={amend}
          onToggleAmend={setAmend}
          onChangeMessage={setMessage}
          onCommit={commit}
        />
      )}

      <GitStashSection
        rootPath={rootPath}
        repo={activeRepo}
        isBusy={isBusy}
        onAction={(actionType, extra) => handleAction(actionType, undefined, extra)}
      />
      
      {/* Changes List / Tree */}
      <GitChangesList
        changes={changes}
        isLoading={isBusy}
        viewMode={viewMode}
        repo={activeRepo}
        rootPath={rootPath}
        onAction={handleAction}
        onResolve={handleResolveConflict}
      />
    </div>
  );
}
