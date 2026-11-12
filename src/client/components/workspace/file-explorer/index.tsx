import { useEffect, useRef, useState } from 'preact/hooks';
import type { FsNode } from '@/shared/types';
import { FileExplorerToolbar } from '@/client/components/workspace/file-explorer/Toolbar';
import { FileTreeItem } from '@/client/components/workspace/file-explorer/TreeItem';
import { RootOverlays } from '@/client/components/workspace/file-explorer/RootOverlays';
import { ArchiveOverlays } from '@/client/components/workspace/file-explorer/ArchiveModals';
import { OutlineSection } from '@/client/components/workspace/file-explorer/OutlineSection';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { useFileListing } from '@/client/hooks/workspace/file-listing';
import { useFileCreate } from '@/client/hooks/workspace/file-create';
import { useFileClipboard, type ClipboardTarget } from '@/client/hooks/workspace/file-clipboard';
import { useFileArchive } from '@/client/hooks/workspace/file-archive';
import { useFileSelection, visibleEntriesOf } from '@/client/hooks/workspace/file-selection';
import { useFileTreeEdits } from '@/client/hooks/workspace/file-tree-edits';
import { useUnfoldedChains } from '@/client/hooks/workspace/unfolded-chains';
import { filterFileTree } from '@/client/components/workspace/file-explorer/filter';
import { useRepoList, useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useTouchDevice } from '@/client/hooks/ui/touch-device';
import { fsTopic } from '@/shared/lib/realtime/protocol';
import { unfoldChains } from '@/shared/lib/fs/folder-chain';
import { clipboardLabel } from '@/shared/lib/fs/clipboard';
import { useRootDropTarget } from '@/client/hooks/workspace/root-drop-target';

export function FileExplorer({ className = '', enabled = true, active = true, rootPath, onOpenFile, refreshKey = 0, onRefresh }: { className?: string, enabled?: boolean, active?: boolean, rootPath?: string, onOpenFile?: (file: any) => void, refreshKey?: number, onRefresh?: () => void }) {
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
    if (!expandedPathsReady || !active) return;
    void listing.reload();
    // `listing.reload` reads the current scope and expansion set off refs, so
    // the effect is keyed on what should trigger a read, not on the callback.
    // `active` is one of them: the layout keeps this view MOUNTED while the
    // right column is collapsed (or another view is on screen), so without it a
    // reopened panel would draw the tree it read when it was last looked at —
    // a file added, deleted or renamed outside this panel in between would not
    // be there. While inactive the panel starts no reload of its own; being
    // shown again IS the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, rootPath, enabled, activeRepo, expandedPathsReady, active]);

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

  // A collapsed chain row is ONE row standing for several directories, so the
  // levels inside its label have no row to drop on (a drop lands in the deepest
  // directory) and no row to rename. Unfolding — on a hovering drag, or from the
  // row's own menu — turns each level back into a row.
  const { unfolded, unfold, fold, rekey: rekeyUnfold } = useUnfoldedChains({ scope: listing.scope, setExpandedPaths, setStoredExpandedPaths });

  const tree = listing.files;
  const projected = unfoldChains(tree, unfolded);
  const files = filterFileTree(projected.nodes, searchQuery);

  // The rows the tree is DRAWN as, in order: a shift-range selects exactly what
  // the user can see, and the marked set is what Cut/Copy/Compress act on.
  // Computing it above the `!enabled` return keeps the hooks unconditional.
  const selectionOrder = visibleEntriesOf(files, (node) =>
    node.forceExpanded !== undefined ? node.forceExpanded : expandedPaths.has(node.path),
  );
  const selection = useFileSelection(selectionOrder.map((entry) => entry.path));
  const selectedTargets: ClipboardTarget[] = selectionOrder
    .filter((entry) => selection.selected.has(entry.path))
    .map(({ path, name, kind }) => ({ path, name, kind }));

  const handleSelectRepo = (repo: string) => {
    if (repo === activeRepo) return;
    // The expansion set holds paths relative to the repo that was listed, so a
    // repo switch starts from a collapsed tree. (A workspace switch needs no
    // equivalent: the listing is re-read under the new root, and the session's
    // own expansion set is restored with the session.)
    listing.reset();
    setExpandedPaths(new Set());
    setStoredExpandedPaths([]);
    selection.clear();
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

  // A create and a rename land locally, and the row they produce is revealed
  // through the rows that are DRAWN — see `useFileTreeEdits`.
  const { insertCreated, moveRenamed } = useFileTreeEdits({
    listing,
    setExpandedPaths,
    setStoredExpandedPaths,
    reload: refresh,
    onMoved: (fromPath, toPath) => rekeyUnfold(fromPath, toPath),
  });

  // One clipboard for the whole tree, owned here and passed down: a
  // subscription per row would be hundreds of listeners for a value that
  // changes on a right-click.
  // A row is a drag source; on a finger the native drag is what turned a long
  // press into a text selection of the whole panel (see `useLongPress`).
  const touch = useTouchDevice();
  const { pushToast } = useToasts();
  const clipboard = useFileClipboard({
    rootPath,
    repo: activeRepo,
    onComplete: refresh,
    onError: (message) => pushToast(message, 'error'),
  });
  // One archive flow for the whole tree: the dialogs are single instances in
  // the panel, not one per row.
  const archive = useFileArchive({ rootPath, repo: activeRepo, onComplete: refresh });
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
    ? `Paste ${clipboardLabel(clipboard.clip) ?? 'item'}`
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

  const root = useRootDropTarget({ dragging, clipboard, target: rootTarget });

  // The root's own "New File": the panel background is the one target whose
  // create belongs at the tree's top, and it is the only action the root menu
  // offers (a row's menu names a FILE, which the root is not).
  const rootCreate = useFileCreate({
    folderPath: '.',
    rootPath,
    repo: activeRepo,
    onCreated: insertCreated,
    onOpenCreated: (file) => onOpenFile?.({ ...file, root: rootPath, repo: activeRepo }),
  });
  /** Portals need a real document; the first client render is the gate. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape drops the marked set. It rides the window rather than the tree
  // because focus sits wherever the last click left it, and a selection that
  // could only be cleared by clicking exactly the right row is a trap.
  const selectionCount = selection.count;
  const clearSelection = selection.clear;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectionCount > 0) clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, selectionCount, clearSelection]);

  if (!enabled) {
    return (
      <div className={`flex flex-col h-full bg-paper items-center justify-center text-ink/40 ${className}`}>
        <span className="text-xs font-mono text-muted">No session selected</span>
      </div>
    );
  }

  // The button spins for this panel's own read OR a topic push: the server
  // republishes `fs:` on every tool call, so the tree moved with nothing on
  // screen saying so otherwise.
  const isRefreshing = listing.isLoading || rootListing.refreshing;

  return (
    <div className={`flex flex-col h-full bg-paper ${className}`}>
      <FileExplorerToolbar
        rootPath={rootPath}
        activeRepo={activeRepo}
        repos={repos}
        reposScanning={reposScanning}
        onRefreshRepos={rescanRepos}
        onSelectRepo={handleSelectRepo}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={refresh}
        refreshing={isRefreshing}
      />

      <div
        className={`flex-1 scrollbar-overlay-container p-2 font-mono text-[11px] text-ink/80 ${
          touch ? 'file-tree-touch' : ''
        } ${root.highlighted ? 'bg-info/[0.06]' : ''}`}
        onContextMenu={(e) => {
          // The panel's own background. A row stops propagation before this
          // runs, so this handler only ever sees a right-click that named NO
          // file — which is what makes the root's menu a different menu.
          e.preventDefault();
          setRootMenu({ x: e.clientX, y: e.clientY });
        }}
        onDragEnter={root.onDragEnter}
        onDragLeave={root.onDragLeave}
        onDragOver={root.onDragOver}
        onDrop={root.onDrop}
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
              key={file.path}
              file={file}
              rootPath={rootPath}
              basePath={listing.root}
              repo={activeRepo}
              onLoadChildren={loadChildren}
              onOpenFile={onOpenFile}
              onActionComplete={refresh}
              onCreated={insertCreated}
              onRenamed={moveRenamed}
              expandedPaths={expandedPaths}
              onToggleFolder={handleToggleFolder}
              gitFileMap={gitFileMap}
              gitFolderMap={gitFolderMap}
              clipboard={clipboard}
              archive={archive}
              selection={selection}
              selectionTargets={selectedTargets}
              dragging={dragging}
              onDragStart={setDragging}
              onDragEnd={() => setDragging(null)}
              onDropOn={(target) => {
                if (!dragging) return;
                clipboard.move(dragging, target);
              }}
              onUnfold={unfold}
              onFold={fold}
              foldRoots={projected.roots}
              touch={touch}
            />
          ))
        )}
      </div>

      {/* Pinned below the tree: the tree is the `flex-1` member, so opening this
          shrinks it instead of pushing the section off the bottom of a scroller
          the reader would have to chase — the git panel's stash section rule. */}
      <OutlineSection />

      {mounted && (
        <RootOverlays
          menu={rootMenu}
          menuRef={rootMenuRef}
          pasteLabel={rootPasteLabel}
          busy={clipboard.busy}
          create={rootCreate}
          onAction={(action) => {
            setRootMenu(null);
            if (action === 'new_file') rootCreate.openDialog('file');
            if (action === 'new_folder') rootCreate.openDialog('folder');
            if (action === 'paste') clipboard.paste(rootTarget);
          }}
        />
      )}

      {mounted && <ArchiveOverlays archive={archive} />}

    </div>
  );
}
