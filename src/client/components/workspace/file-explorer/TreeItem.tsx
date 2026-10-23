import { useEffect, useState } from 'preact/hooks';
import { ChevronDown, ChevronRight } from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { FileContextMenu } from '@/client/components/workspace/file-explorer/ContextMenu';
import { FileCreateModal, FileDeleteModal, FileHistoryModal, FileRenameModal } from '@/client/components/workspace/file-explorer/Modals';
import { getGitStatusInfo, type FolderGitStatusInfo } from '@/shared/lib/fs/git-status';
import { useFileActions } from '@/client/hooks/workspace/file-tree-actions';
import { useFileRowDrag } from '@/client/hooks/workspace/file-row-drag';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useLongPress } from '@/client/hooks/ui/long-press';
import type { FileClipboard, ClipboardTarget } from '@/client/hooks/workspace/file-clipboard';
import type { GitChange } from '@/shared/types/git';

interface FileTreeItemProps {
  file: any;
  rootPath?: string;
  /** Absolute base dir of the listing (server-reported `root`), anchors Copy Path. */
  basePath?: string;
  repo?: string;
  onLoadChildren?: (path: string) => Promise<void>;
  onOpenFile?: (file: any) => void;
  /** Re-read the tree — a DELETE has no local answer. */
  onActionComplete: () => void;
  /** Place a row this row's menu just created, without a reload. */
  onCreated?: (entry: { path: string; kind: 'file' | 'folder' }) => void;
  /** Move a row this row's menu just renamed, without a reload. */
  onRenamed?: (fromPath: string, toPath: string) => void;
  expandedPaths?: Set<string>;
  onToggleFolder?: (path: string, open: boolean) => void;
  gitFileMap?: Map<string, GitChange>;
  gitFolderMap?: Map<string, FolderGitStatusInfo>;
  /** The panel's clipboard — one instance for the whole tree, passed down. */
  clipboard: FileClipboard;
  /** The row currently being dragged, or null. Panel state: see `FileTreeItem`. */
  dragging: ClipboardTarget | null;
  /** A drag of this row started / ended / was dropped on `target`. */
  onDragStart: (target: ClipboardTarget) => void;
  onDragEnd: () => void;
  onDropOn: (target: ClipboardTarget) => void;
  /**
   * True on a device typed into with a finger. A row is a drag SOURCE, and on
   * touch a long press starts a native drag of the whole panel — the reported
   * "it selects all of the UI" — while no `contextmenu` reaches this row. The
   * native drag is dropped there and the press opens the menu instead.
   */
  touch?: boolean;
}

/**
 * Whether a folder's children still need reading.
 *
 * `children: null` is the server's "not loaded yet" (see `listing.ts`), and an
 * EMPTY ARRAY is a folder that was read and has nothing in it. Treating the two
 * alike is a loop: the panel patches an empty listing in as `[]`, the row reads
 * that as "not loaded", asks again, and the answer is a fresh array each time —
 * so every render of an open empty folder fired another request, and the row
 * flickered between "Loading…" and nothing (measured: expanding an empty folder
 * re-fetched it on every render, indefinitely).
 *
 * `attempted` closes the other loop: a read that FAILED leaves `children` null,
 * and without the latch the effect would re-ask on every render for a folder
 * that cannot be read. Collapsing the row clears the latch, so expanding it
 * again is a deliberate retry, and the panel's own Refresh re-reads every open
 * folder regardless (see `useFileListing`).
 */
function needsChildrenLoad(file: { children?: unknown }, isLoading: boolean, attempted: boolean): boolean {
  if (isLoading || attempted) return false;
  return !Array.isArray(file.children);
}

export function FileTreeItem({
  file,
  rootPath,
  basePath,
  repo,
  onLoadChildren,
  onOpenFile,
  onActionComplete,
  onCreated,
  onRenamed,
  expandedPaths,
  onToggleFolder,
  gitFileMap,
  gitFolderMap,
  clipboard,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  touch = false,
}: FileTreeItemProps) {
  const isFolder = file.type === 'folder';
  const [isOpen, setIsOpen] = useState(false);
  const [isLoadingChildren, setIsLoadingChildren] = useState(false);
  /** A read has been issued for this row; collapsing clears it. */
  const [attempted, setAttempted] = useState(false);
  /** Portals need a real document; the first client render is the gate. */
  const [mounted, setMounted] = useState(false);
  const children = Array.isArray(file.children) ? file.children : [];

  const normalizedPath = (file.path || '').replace(/^\/+/, '');
  const gitChange = !isFolder ? (gitFileMap?.get(normalizedPath) || gitFileMap?.get(file.path)) : undefined;
  const gitStatusInfo = gitChange ? getGitStatusInfo(gitChange.status, gitChange.staged) : null;
  const folderStatus = isFolder ? (gitFolderMap?.get(normalizedPath) || gitFolderMap?.get(file.path)) : null;
  const hasGitStatus = Boolean(gitStatusInfo);
  // Git-ignored entries (local .gitignore or the global excludes file) are still
  // listed but rendered faded, the way an editor dims untracked noise.
  const isIgnored = file.ignored === true;

  const isExpanded = expandedPaths ? expandedPaths.has(file.path) : isOpen;
  const actualIsOpen = file.forceExpanded !== undefined ? file.forceExpanded : isExpanded;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isFolder && expandedPaths) {
      setIsOpen(expandedPaths.has(file.path));
    }
  }, [expandedPaths, file.path, isFolder]);

  useEffect(() => {
    if (isFolder && actualIsOpen && needsChildrenLoad(file, isLoadingChildren, attempted) && onLoadChildren) {
      setAttempted(true);
      setIsLoadingChildren(true);
      Promise.resolve(onLoadChildren(file.path)).finally(() => setIsLoadingChildren(false));
    }
  }, [isFolder, actualIsOpen, file.children, file.path, onLoadChildren, isLoadingChildren, attempted]);

  const actions = useFileActions({
    file: { path: file.path, name: file.name, basePath, rootPath, repo },
    diff: { staged: gitChange?.staged || (gitChange?.status ? gitChange.status[0] !== ' ' && gitChange.status[0] !== '?' : false), status: gitStatusInfo?.charStatus },
    onOpenFile,
    onActionComplete,
    onCreated,
    onRenamed,
    clipboard,
    isFolder,
  });
  useOnClickOutside(actions.contextMenuRef, actions.closeContextMenu);

  // A press-and-hold opens the same menu a right-click does; the click the same
  // gesture produces is swallowed, or lifting the finger would toggle the row.
  const longPress = useLongPress({
    enabled: touch,
    onLongPress: (x, y) => actions.openContextMenu(x, y),
  });

  const handleToggle = (e: globalThis.MouseEvent) => {
    e.stopPropagation();
    if (longPress.consume()) return;
    if (isFolder) {
      const next = !actualIsOpen;
      setIsOpen(next);
      if (file.forceExpanded !== undefined) {
        file.forceExpanded = undefined;
      }
      onToggleFolder?.(file.path, next);
      // Collapsing forgets the attempt, so expanding again retries a folder
      // whose read failed — the only way back for a folder that was unreadable
      // when it was first opened.
      if (!next) setAttempted(false);
      // The read itself belongs to the effect above, which owns the
      // `isLoadingChildren` latch: issuing one here too read the folder TWICE
      // for one click (the handler's read and the effect's, both seeing
      // `children: null`). An empty folder is a LOADED folder — `children: []`
      // is the server's answer, not a missing one — so re-expanding it does not
      // fetch again, and the row does not flicker between "Loading…" and empty.
    } else {
      if (onOpenFile) {
        onOpenFile({
          ...file,
          root: rootPath,
          repo: repo || '.',
        });
      }
    }
  };

  const handleContextMenu = (e: globalThis.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    actions.openContextMenu(e.clientX, e.clientY);
  };

  /**
   * The row as a drag source and a drop target.
   *
   * The row's own identity is what both roles need: a drop on a FILE lands in
   * that file's directory — the same rule a paste obeys (`pasteTargetDir`) — so
   * a drop beside a file is a real destination rather than an invisible one.
   * The handlers themselves live in the hook, which owns the two platform facts
   * they depend on (see `useFileRowDrag`).
   */
  const target: ClipboardTarget = {
    path: file.path,
    name: file.name,
    kind: isFolder ? 'folder' : 'file',
  };
  const drag = useFileRowDrag({ target, dragging, clipboard, onDragStart, onDragEnd, onDropOn });

  return (
    <div>
      <div
        className={`flex items-center space-x-1.5 py-1 px-2 hover:bg-ink/5 cursor-pointer rounded group select-none ${
          drag.isDragging ? 'opacity-40' : ''
        } ${drag.acceptsDrop ? 'bg-info/10 ring-1 ring-info/40 ring-inset' : ''}`}
        draggable={!touch}
        onClick={handleToggle}
        onContextMenu={handleContextMenu}
        onDragStart={drag.onDragStart}
        onDragEnd={drag.onDragEnd}
        onDragOver={drag.onDragOver}
        onDrop={drag.onDrop}
        onTouchStart={longPress.onTouchStart}
        onTouchMove={longPress.onTouchMove}
        onTouchEnd={longPress.onTouchEnd}
        onTouchCancel={longPress.onTouchCancel}
      >
        {isFolder ? (
          actualIsOpen ? <ChevronDown size={12} className="flex-shrink-0 text-ink/40" /> : <ChevronRight size={12} className="flex-shrink-0 text-ink/40" />
        ) : (
          <span className="w-3 flex-shrink-0"></span>
        )}

        <FileIcon name={file.name} isFolder={isFolder} isOpen={actualIsOpen} size={12} className={`flex-shrink-0${isIgnored ? ' opacity-40' : ''}`} />
        <span
          className={`truncate min-w-0 flex-1 ${gitStatusInfo ? gitStatusInfo.colorClass : folderStatus ? folderStatus.colorClass : isIgnored ? 'text-ink/40' : ''}`}
          title={isIgnored ? `${file.path} — git-ignored` : undefined}
        >
          {file.name}
        </span>

        {gitStatusInfo && (
          <span
            className={`font-mono text-[9px] font-bold px-1 rounded flex-shrink-0 ${gitStatusInfo.colorClass}`}
            title={`Git: ${gitStatusInfo.label}`}
          >
            {gitStatusInfo.charStatus}
          </span>
        )}

        {folderStatus && (
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              folderStatus.hasDeleted ? 'bg-error' :
              folderStatus.hasModified || folderStatus.hasStaged ? 'bg-info' : 'bg-success'
            }`}
            title={`${folderStatus.count} changed file${folderStatus.count > 1 ? 's' : ''}`}
          />
        )}
      </div>

      {actualIsOpen && isLoadingChildren && (
        <div className="ml-3 border-l border-ink/10 pl-3 py-0.5 text-[10px] text-ink/30">Loading…</div>
      )}

      {actualIsOpen && !isLoadingChildren && children.length > 0 && (
        <div className="ml-3 border-l border-ink/10 pl-1">
          {children.map((child: any) => (
            <FileTreeItem
              key={child.path}
              file={child}
              rootPath={rootPath}
              basePath={basePath}
              repo={repo}
              onLoadChildren={onLoadChildren}
              onOpenFile={onOpenFile}
              onActionComplete={onActionComplete}
              onCreated={onCreated}
              onRenamed={onRenamed}
              expandedPaths={expandedPaths}
              onToggleFolder={onToggleFolder}
              gitFileMap={gitFileMap}
              gitFolderMap={gitFolderMap}
              clipboard={clipboard}
              dragging={dragging}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOn={onDropOn}
              touch={touch}
            />
          ))}
        </div>
      )}

      {mounted && actions.contextMenu && (
        <FileContextMenu
          x={actions.contextMenu.x}
          y={actions.contextMenu.y}
          isFolder={isFolder}
          hasGitStatus={hasGitStatus}
          pasteLabel={actions.pasteLabel}
          busy={actions.busy}
          onAction={actions.handleAction}
        />
      )}

      {mounted && actions.showCreateModal && (
        <FileCreateModal
          folderPath={file.path}
          kind={actions.createKind}
          value={actions.createName}
          error={actions.createError}
          isLoading={actions.busy}
          onChange={actions.setCreateName}
          onCancel={actions.closeCreate}
          onSubmit={actions.submitCreate}
        />
      )}

      {mounted && actions.showDeleteModal && (
        <FileDeleteModal
          fileName={file.name}
          isFolder={isFolder}
          isLoading={actions.busy}
          onCancel={actions.closeDelete}
          onConfirm={actions.submitDelete}
        />
      )}

      {mounted && actions.showRenameModal && (
        <FileRenameModal
          isFolder={isFolder}
          renameValue={actions.renameValue}
          originalPath={file.path}
          error={actions.renameError}
          isLoading={actions.busy}
          onChange={actions.setRenameValue}
          onCancel={actions.closeRename}
          onSubmit={actions.submitRename}
        />
      )}

      {mounted && actions.showHistoryModal && (
        <FileHistoryModal
          filePath={file.path}
          fetcherState={actions.fetcherState}
          fetcherData={actions.fetcherData}
          onClose={actions.closeHistory}
        />
      )}
    </div>
  );
}

