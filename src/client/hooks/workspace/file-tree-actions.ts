/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Everything a file-tree row does that is not rendering: the context menu's
 * action dispatch, the rename/delete/history dialogs and their server calls.
 *
 * Extracted from the row component because it is a stateful cluster with one
 * shared dependency (`/api/fs/action` and the fetcher that submits to it), and
 * because the row is at the repository's line ceiling. The component keeps the
 * markup and the handlers that need its own DOM node; this keeps the behavior.
 *
 * The row's "New File" is NOT implemented here: it delegates to `useFileCreate`,
 * the same flow the panel's own background menu uses, so the two cannot drift on
 * what a refusal and a success do.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { FormEvent, RefObject } from 'preact/compat';
import { useFetcher } from '@/client/lib/router/fetcher';
import { toAbsolutePath } from '@/shared/lib/fs/paths';
import { copyToClipboard } from '@/client/hooks/ui/clipboard';
import { useFileCreate } from '@/client/hooks/workspace/file-create';
import type { FileClipboard } from '@/client/hooks/workspace/file-clipboard';
import type { FsActionResponse } from '@/shared/types';

export interface FileActionTarget {
  path: string;
  name: string;
  /** Absolute base dir of the listing, anchoring Copy Path. */
  basePath?: string;
  rootPath?: string;
  repo?: string;
}

export interface FileActionDeps {
  file: FileActionTarget;
  /** Which diff to open, when the row is a changed file. */
  diff?: { staged?: boolean; status?: string };
  onOpenFile?: (file: { path: string; name: string; root?: string; repo?: string }) => void;
  onActionComplete: () => void;
  /** The panel's clipboard: Cut/Copy fill it, Paste reads it. */
  clipboard: FileClipboard;
  /** Whether this row is a folder — what Cut/Copy/Paste need to name their target. */
  isFolder: boolean;
}

export interface FileActions {
  contextMenu: { x: number; y: number } | null;
  contextMenuRef: RefObject<HTMLDivElement>;
  openContextMenu: (x: number, y: number) => void;
  closeContextMenu: () => void;
  showRenameModal: boolean;
  showDeleteModal: boolean;
  showHistoryModal: boolean;
  showCreateModal: boolean;
  /** The server's refusal for the create request, rendered inside its dialog. */
  createError: string | null;
  createName: string;
  setCreateName: (value: string) => void;
  renameValue: string;
  setRenameValue: (value: string) => void;
  /** True while a request is in flight; every dialog's buttons read it. */
  busy: boolean;
  /** Label of the row's Paste action, or null when a paste cannot land here. */
  pasteLabel: string | null;
  /** The fetcher's own state/data, for the history modal. */
  fetcherState: string;
  fetcherData: FsActionResponse | undefined;
  handleAction: (actionType: string) => void;
  submitCreate: (e: FormEvent) => void;
  submitRename: (e: FormEvent) => void;
  submitDelete: () => void;
  closeCreate: () => void;
  closeDelete: () => void;
  closeRename: () => void;
  closeHistory: () => void;
}

export function useFileActions({ file, diff, onOpenFile, onActionComplete, clipboard, isFolder }: FileActionDeps): FileActions {
  const actionFetcher = useFetcher<FsActionResponse>();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [renameValue, setRenameValue] = useState(file.path);

  const repo = file.repo;
  const rootPath = file.rootPath;

  // The row's own "New File": the SAME flow the panel's root menu uses, so a
  // refusal keeps the dialog open with the server's reason and a success opens
  // the file — two copies of that rule would drift.
  const create = useFileCreate({
    folderPath: file.path,
    rootPath,
    repo,
    onCreated: onActionComplete,
    onOpenCreated: (created) => onOpenFile?.({ ...created, root: rootPath, repo: repo || '.' }),
  });

  /**
   * The payload already acted on.
   *
   * The fetcher keeps `data` until the next request, and the callbacks below
   * (`onActionComplete` → the panel's refresh → a re-render with a fresh
   * callback identity) would otherwise re-run this effect for the SAME
   * response forever: an unguarded effect here is an infinite refresh loop that
   * pins the tab the moment a file is created.
   */
  const handledRef = useRef<FsActionResponse | null>(null);

  useEffect(() => {
    if (actionFetcher.state !== 'idle' || !actionFetcher.data) return;
    const data = actionFetcher.data;
    if (handledRef.current === data) return;
    handledRef.current = data;
    // A create never reaches here: it rides its own fetcher (see
    // `useFileCreate`), so this one only ever answers a rename, a delete or a
    // history read.
    if (data.success && !data.type) {
      setShowRenameModal(false);
      setShowDeleteModal(false);
      onActionComplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFetcher.state, actionFetcher.data]);

  const submitAction = (formData: FormData) => {
    if (repo && repo !== '.') formData.append('repo', repo);
    if (rootPath) formData.append('root', rootPath);
    void actionFetcher.submit(formData, { method: 'post', action: '/api/fs/action' });
  };

  const openFile = () => {
    onOpenFile?.({ path: file.path, name: file.name, root: rootPath, repo: repo || '.' });
  };

  const clipboardTarget = { path: file.path, name: file.name, kind: isFolder ? 'folder' as const : 'file' as const };
  /**
   * The row's Paste label, or null when a paste cannot land here.
   *
   * A refusal is not a disabled row: a folder inside the copied folder's own
   * subtree, or an entry from another workspace, has no destination — and a row
   * that is always present and always refuses reads as broken. The reason
   * itself is reported when the paste is attempted through the panel's own
   * background menu, which cannot know which rows are illegal.
   */
  const pasteLabel = clipboard.clip && !clipboard.refusalFor(clipboardTarget)
    ? `Paste ${clipboard.clip.name}`
    : null;

  const handleAction = (actionType: string) => {
    setContextMenu(null);
    if (actionType === 'view') {
      openFile();
    } else if (actionType === 'diff') {
      window.dispatchEvent(new CustomEvent('omp:open-diff', {
        detail: {
          file: file.path,
          staged: diff?.staged,
          status: diff?.status || 'M',
          repo: repo || '.',
          root: rootPath,
        },
      }));
    } else if (actionType === 'explorer') {
      const fd = new FormData();
      fd.append('actionType', 'open_explorer');
      fd.append('path', file.path);
      submitAction(fd);
    } else if (actionType === 'copy_path') {
      void copyToClipboard(toAbsolutePath(file.basePath, file.path));
    } else if (actionType === 'copy_relative') {
      void copyToClipboard(file.path);
    } else if (actionType === 'history') {
      setShowHistoryModal(true);
      const fd = new FormData();
      fd.append('actionType', 'git_history');
      fd.append('path', file.path);
      submitAction(fd);
    } else if (actionType === 'rename') {
      setRenameValue(file.path);
      setShowRenameModal(true);
    } else if (actionType === 'new_file') {
      create.openDialog();
    } else if (actionType === 'delete') {
      setShowDeleteModal(true);
    } else if (actionType === 'cut') {
      clipboard.cut(clipboardTarget);
    } else if (actionType === 'copy') {
      clipboard.copy(clipboardTarget);
    } else if (actionType === 'duplicate') {
      clipboard.duplicate(clipboardTarget);
    } else if (actionType === 'paste') {
      clipboard.paste(clipboardTarget);
    }
  };

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('actionType', 'rename');
    fd.append('path', file.path);
    fd.append('newPath', renameValue);
    submitAction(fd);
  };

  const submitDelete = () => {
    const fd = new FormData();
    fd.append('actionType', 'delete');
    fd.append('path', file.path);
    submitAction(fd);
  };

  return {
    contextMenu,
    contextMenuRef,
    openContextMenu: (x, y) => setContextMenu({ x, y }),
    closeContextMenu: () => setContextMenu(null),
    showRenameModal,
    showDeleteModal,
    showHistoryModal,
    showCreateModal: create.open,
    createError: create.error,
    createName: create.name,
    setCreateName: create.setName,
    renameValue,
    setRenameValue,
    busy: actionFetcher.state !== 'idle' || create.busy || clipboard.busy,
    pasteLabel,
    fetcherState: actionFetcher.state,
    fetcherData: actionFetcher.data,
    handleAction,
    submitCreate: create.submit,
    submitRename,
    submitDelete,
    closeCreate: create.closeDialog,
    closeDelete: () => setShowDeleteModal(false),
    closeRename: () => setShowRenameModal(false),
    closeHistory: () => setShowHistoryModal(false),
  };
}
