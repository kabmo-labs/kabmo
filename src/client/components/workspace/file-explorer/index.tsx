import { useEffect, useRef, useState } from 'preact/hooks';
import { RefreshCw, Search } from 'lucide-preact';
import type { FsNode } from '@/shared/types';
import { GitRepoDropdown } from '@/client/components/workspace/file-explorer/GitRepoDropdown';
import { FileTreeItem } from '@/client/components/workspace/file-explorer/TreeItem';
import { RootContextMenu } from '@/client/components/workspace/file-explorer/RootMenu';
import { FileCreateModal } from '@/client/components/workspace/file-explorer/Modals';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { useFileListing } from '@/client/hooks/workspace/file-listing';
import { useFileCreate } from '@/client/hooks/workspace/file-create';
import { useFileClipboard, type ClipboardTarget } from '@/client/hooks/workspace/file-clipboard';
import { useRepoList, useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { useToasts } from '@/client/hooks/ui/toasts';
import { ToastStack } from '@/client/components/common/ToastStack';
import { fsTopic } from '@/shared/lib/realtime/protocol';

export function FileExplorer({ className = '', enabled = true, rootPath, onOpenFile, refreshKey = 0, onRefresh }: { className?: string, enabled?: boolean, rootPath?: string, onOpenFile?: (file: any) => void, refreshKey?: number, onRefresh?: () => void }) {
  const [searchQuery, setSearchQuery] = useSessionState<string>('files.searchQuery', '');
  const [storedExpandedPaths, setStoredExpandedPaths, expandedPathsReady] = useSessionState<string[]>('files.expandedPaths', []);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(storedExpandedPaths));
  const { activeRepo, setActiveRepo } = useRepoScope(rootPath);
  const { repos, scanning: reposScanning, rescan: rescanRepos } = useRepoList(rootPath, enabled);
  const { fileMap: gitFileMap, folderMap: gitFolderMap, refreshGitStatus } = useGitStatus(rootPath, activeRepo, enabled);
  /** The panel background's own menu — the only place a file can be created at the tree's root. */
  const [rootMenu, setRootMenu] = useState<{ x: number; y: number } | null>(null);
  const rootMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expandedPathsReady) return;
    setExpandedPaths(prev => {
      const next = new Set(storedExpandedPaths);
      if (prev.size === next.size && Array.from(next).every(path => prev.has(path))) return prev;
      return next;
    });
  }, [expandedPathsReady, storedExpandedPaths]);

  // The tree lives in the hook so a refresh can re-read the open folders too,
  // and so a folder that no longer exists leaves the expansion set instead of
  // being asked about on every pass.
  const listing = useFileListing({
    enabled,
    rootPath,
    activeRepo,
    expandedPaths,
    onExpansionPruned: (remaining) => {
      setExpandedPaths(remaining);
      setStoredExpandedPaths(Array.from(remaining));
    },
  });

  useEffect(() => {
    if (!expandedPathsReady) return;
    void listing.reload();
    // `listing.reload` reads the current scope and expansion set off refs, so
    // the effect is keyed on what should trigger a read, not on the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, rootPath, enabled, activeRepo, expandedPathsReady]);

  // The ROOT listing rides the `fs:<root>\0<repo>` topic: the server pushes a
  // fresh read when a run's work may have touched the tree. Expanded CHILDREN
  // stay on their own request — a topic snapshot is one directory, and the
  // panel's expanded set is per user.
  const fsTopicName = enabled && expandedPathsReady ? fsTopic(listing.scope) : null;
  const rootListing = useRealtimeTopic<{ files: FsNode[]; root: string }>(fsTopicName);
  useEffect(() => {
    if (rootListing.data) listing.adoptRoot(rootListing.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootListing.data]);

  const loadChildren = (path: string) => {
    // Expanding IS a directory load: fetch the children AND re-read git status,
    // so a freshly listed row never renders bare next to a status map that
    // still predates its change (the topic snapshot alone can lag a fresh edit).
    refreshGitStatus();
    return listing.loadChildren(path);
  };

  const handleToggleFolder = (path: string, open: boolean) => {
    const next = new Set(expandedPaths);
    if (open) next.add(path);
    else next.delete(path);
    setExpandedPaths(next);
    setStoredExpandedPaths(Array.from(next));
  };

  const handleSelectRepo = (repo: string) => {
    if (repo === activeRepo) return;
    // The expansion set holds paths relative to the repo that was listed, so a
    // repo switch starts from a collapsed tree. (A workspace switch needs no
    // equivalent: the listing is re-read under the new root, and the session's
    // own expansion set is restored with the session.)
    listing.reset();
    setExpandedPaths(new Set());
    setStoredExpandedPaths([]);
    setActiveRepo(repo);
  };

  /**
   * Re-read everything this panel shows. Defined ABOVE the `!enabled` return so
   * the create flow below can use it: a hook cannot be called after a branch.
   */
  const refresh = () => {
    refreshGitStatus();
    if (onRefresh) onRefresh();
    else void listing.reload();
  };

  // One clipboard for the whole tree, owned here and passed down: a
  // subscription per row would be hundreds of listeners for a value that
  // changes on a right-click.
  const { toasts, pushToast, dismissToast } = useToasts();
  const clipboard = useFileClipboard({
    rootPath,
    repo: activeRepo,
    onComplete: refresh,
    onError: (message) => pushToast(message, 'error'),
  });
  /**
   * The background's Paste label, or null when a paste cannot land at the root.
   *
   * The root is a folder like any other, so the SAME rule decides it: an entry
   * from another workspace is not this listing's to paste, and a row that is
   * always there and always refuses reads as broken. Pasting into the root is
   * how an entry is moved back out of a folder, since the tree offers no drag.
   */
  const rootTarget = { path: '.', name: '.', kind: 'folder' as const };
  const rootPasteLabel = clipboard.clip && !clipboard.refusalFor(rootTarget)
    ? `Paste ${clipboard.clip.name}`
    : null;

  /**
   * The row a drag is currently carrying, or null.
   *
   * Panel state rather than read off the drag event: `dataTransfer.getData()`
   * returns an empty string during `dragover` — the payload is only released at
   * the drop — so a drop target has no way to ask the event what is being
   * dragged. `dragover` is also the only moment a target may refuse, which is
   * why the entry has to be readable there.
   */
  const [dragging, setDragging] = useState<ClipboardTarget | null>(null);

  /**
   * Whether the listing root may accept the drag in flight — the background is
   * a drop target like any other, and the rule is the same one a row uses.
   */
  const rootAcceptsDrop = Boolean(dragging) && clipboard.moveRefusalFor(dragging!, rootTarget) === null;

  // The root's own "New File": the panel background is the one target whose
  // create belongs at the tree's top, and it is the only action the root menu
  // offers (a row's menu names a FILE, which the root is not).
  const rootCreate = useFileCreate({
    folderPath: '.',
    rootPath,
    repo: activeRepo,
    onCreated: refresh,
    onOpenCreated: (file) => onOpenFile?.({ ...file, root: rootPath, repo: activeRepo }),
  });
  /** Portals need a real document; the first client render is the gate. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!enabled) {
    return (
      <div className={`flex flex-col h-full bg-paper items-center justify-center text-ink/40 ${className}`}>
        <span className="text-xs font-mono">No session selected</span>
      </div>
    );
  }

  const tree = listing.files;

  const getFilteredFiles = () => {
    if (!searchQuery.trim()) return tree;

    const lowerQuery = searchQuery.toLowerCase();

    const filterNode = (node: any): any => {
      const isMatch = node.name.toLowerCase().includes(lowerQuery);

      if (node.type === 'folder') {
        const filteredChildren = (node.children || []).map(filterNode).filter(Boolean);

        if (isMatch || filteredChildren.length > 0) {
          return {
            ...node,
            children: isMatch && filteredChildren.length === 0 ? node.children : filteredChildren,
            forceExpanded: true
          };
        }
        return null;
      }

      return isMatch ? node : null;
    };

    return tree.map(filterNode).filter(Boolean);
  };

  const files = getFilteredFiles();
  // The button spins for this panel's own read OR a topic push: the server
  // republishes `fs:` on every tool call, so the tree moved with nothing on
  // screen saying so otherwise.
  const isRefreshing = listing.isLoading || rootListing.refreshing;

  return (
    <div className={`flex flex-col h-full bg-paper ${className}`}>
      <div className="p-3 border-b border-ink/10 flex flex-col space-y-2">
        <div className="flex items-center justify-between">
          <GitRepoDropdown
            rootPath={rootPath}
            activeRepo={activeRepo}
            onSelectRepo={handleSelectRepo}
            repos={repos}
            scanning={reposScanning}
            onRefreshRepos={rescanRepos}
          />
          <button
            onClick={refresh}
            className="p-1.5 text-ink/40 hover:text-ink hover:bg-ink/5 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            className="w-full bg-canvas border border-ink/20 rounded pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-ink transition-colors text-ink placeholder-ink/40"
          />
        </div>
      </div>

      <div
        className={`flex-1 scrollbar-overlay-container p-2 font-mono text-[11px] text-ink/80 ${
          rootAcceptsDrop ? 'bg-info/[0.06]' : ''
        }`}
        onContextMenu={(e) => {
          // The panel's own background. A row stops propagation before this
          // runs, so this handler only ever sees a right-click that named NO
          // file — which is what makes the root's menu a different menu.
          e.preventDefault();
          setRootMenu({ x: e.clientX, y: e.clientY });
        }}
        onDragOver={(e) => {
          // The background is the LISTING ROOT's drop target — the only way to
          // move an entry back out of a folder, since a drop on a file lands in
          // that file's own directory instead.
          if (!rootAcceptsDrop) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          if (!rootAcceptsDrop) return;
          e.preventDefault();
          clipboard.move(dragging!, rootTarget);
        }}
      >
        {listing.isLoading && files.length === 0 ? (
          <div className="p-4 text-center text-ink/40">
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-center text-ink/40">
            No files found
          </div>
        ) : (
          files.map(file => (
            <FileTreeItem
              key={file.id}
              file={file}
              rootPath={rootPath}
              basePath={listing.root}
              repo={activeRepo}
              onLoadChildren={loadChildren}
              onOpenFile={onOpenFile}
              onActionComplete={refresh}
              expandedPaths={expandedPaths}
              onToggleFolder={handleToggleFolder}
              gitFileMap={gitFileMap}
              gitFolderMap={gitFolderMap}
              clipboard={clipboard}
              dragging={dragging}
              onDragStart={setDragging}
              onDragEnd={() => setDragging(null)}
              onDropOn={(target) => {
                if (!dragging) return;
                clipboard.move(dragging, target);
              }}
            />
          ))
        )}
      </div>

      {mounted && rootMenu && (
        <RootContextMenu
          x={rootMenu.x}
          y={rootMenu.y}
          menuRef={rootMenuRef}
          pasteLabel={rootPasteLabel}
          busy={clipboard.busy}
          onAction={(action) => {
            setRootMenu(null);
            if (action === 'new_file') rootCreate.openDialog();
            if (action === 'paste') clipboard.paste(rootTarget);
          }}
        />
      )}

      {mounted && rootCreate.open && (
        <FileCreateModal
          folderPath="."
          value={rootCreate.name}
          error={rootCreate.error}
          isLoading={rootCreate.busy}
          onChange={rootCreate.setName}
          onCancel={rootCreate.closeDialog}
          onSubmit={rootCreate.submit}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
