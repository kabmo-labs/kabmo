/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's listing state: the root read, the children of every open
 * folder, and the scope both belong to.
 *
 * Extracted from the panel because the two halves cannot be reasoned about
 * apart. A refresh that re-read only the ROOT left every expanded folder
 * rendering the children it had been cached with, so a file or folder deleted
 * inside one stayed on screen until the scope changed — the panel's own Refresh
 * included (measured: deleting a nested folder left it listed under its open
 * parent, and re-reading the root could not fix it, because the root listing
 * never carried that folder's children). Re-reading the open folders is
 * therefore part of what a refresh IS, not something the caller remembers to
 * ask for.
 *
 * Everything is tagged with the `root\0repo` scope it was read for, so a
 * workspace or repo switch renders nothing from the previous tree: the children
 * cache and the expansion set are keyed by paths RELATIVE to the listed root,
 * and `src/` in one workspace would otherwise rehydrate into `src/` in the next.
 */

import { useRef, useState } from 'preact/hooks';
import type { FsNode } from '@/shared/types';
import { placeEntry, rehydrateTree, setChildrenAt, takeEntry, rekeyCache } from '@/shared/lib/fs/file-tree';
import { isRecord } from '@/shared/lib/util/guards';

/**
 * Read one `/api/fs/dir` payload.
 *
 * `missing` is a folder the server refused — it is gone, or not readable — and
 * it must be told apart from a request that never answered. Collapsing the two
 * would either prune a branch over a network blip or leave a deleted folder in
 * the expansion set to be asked about on every refresh, forever. A folder that
 * IS empty answers with no entries but still names its scope root, so an empty
 * folder is a successful read and never a missing one.
 */
type DirRead =
  | { status: 'ok'; files: FsNode[]; root: string }
  | { status: 'missing' }
  | { status: 'failed' };

function readDirPayload(data: unknown): DirRead {
  if (!isRecord(data)) return { status: 'missing' };
  if (typeof data.root !== 'string' || data.root === '') return { status: 'missing' };
  return {
    status: 'ok',
    files: Array.isArray(data.files) ? data.files.filter((f): f is FsNode => isRecord(f)) : [],
    root: data.root,
  };
}

/** Fetch one directory, distinguishing a refusal from a transport failure. */
async function readDir(url: string): Promise<DirRead> {
  try {
    return readDirPayload(await (await fetch(url)).json());
  } catch {
    return { status: 'failed' };
  }
}

export interface FileListingOptions {
  enabled: boolean;
  rootPath?: string;
  activeRepo: string;
  /** Paths (relative to the listed root) whose children the user has open. */
  expandedPaths: Set<string>;
  /** The expansion set after the folders that no longer exist were dropped. */
  onExpansionPruned: (remaining: Set<string>) => void;
}

export interface FileListing {
  /** The scope (`root\0repo`) every request and cached path belongs to. */
  scope: string;
  /** The root listing for the current scope; empty until one lands. */
  files: FsNode[];
  /** Absolute base dir of the listing (server-reported), anchoring Copy Path. */
  root: string;
  isLoading: boolean;
  /** Re-read the root listing AND the children of every open folder. */
  reload: () => Promise<void>;
  /** Read one folder's children (expanding a row). */
  loadChildren: (path: string) => Promise<void>;
  /** Adopt a realtime root snapshot, then re-read the open folders. */
  adoptRoot: (payload: unknown) => void;
  /**
   * Insert a row the panel just created, without a reload.
   *
   * A create answers with the entry's path, so the tree already knows the whole
   * result; re-reading the root plus every open folder to learn it back would
   * be one request per open folder for an answer the caller holds.
   */
  insertEntry: (entry: { path: string; kind: 'file' | 'folder' }) => void;
  /**
   * Move a row the panel just renamed, without a reload. Returns the folders
   * whose path moved, so the caller can rekey its expansion set — a renamed
   * folder's open branches are still open, under their new names.
   */
  moveEntry: (fromPath: string, toPath: string) => void;
  /** Forget the root listing and every cached child (a repo switch). */
  reset: () => void;
}

export function useFileListing({
  enabled,
  rootPath,
  activeRepo,
  expandedPaths,
  onExpansionPruned,
}: FileListingOptions): FileListing {
  // The scope every request and every cached child path belongs to. A change to
  // it means the previous workspace's or repo's entries are not this one's, so
  // nothing read under the old value may be rendered.
  const scope = `${rootPath ?? ''}\u0000${activeRepo}`;
  const [state, setState] = useState<{ scope: string; files: FsNode[]; root: string }>({
    scope: '',
    files: [],
    root: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  /** Children read per folder, keyed by path relative to the listed root. */
  const childrenCacheRef = useRef<Record<string, FsNode[]>>({});
  /** The ROOT listing as the server emitted it — every folder with
   *  `children: null` — which is what a rebuilt tree rehydrates onto. */
  const rootFilesRef = useRef<FsNode[]>([]);
  // Read outside the render closure so an async read can tell a superseded tree
  // from the current one.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const listedScopeRef = useRef('');
  /** The absolute base dir the current listing was read for — what `commit` stamps. */
  const listedRootRef = useRef('');
  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;

  const listUrl = (path?: string) => {
    const params = new URLSearchParams();
    if (rootPath) params.set('root', rootPath);
    if (activeRepo && activeRepo !== '.') params.set('repo', activeRepo);
    if (path) params.set('path', path);
    params.set('t', String(Date.now()));
    return `/api/fs/dir?${params.toString()}`;
  };

  /** Render the tree from the current root listing plus the children cache. */
  const commit = (requested: string, root: string) => {
    listedScopeRef.current = requested;
    listedRootRef.current = root;
    setState({
      scope: requested,
      files: rehydrateTree(rootFilesRef.current, childrenCacheRef.current),
      root,
    });
  };

  /**
   * Re-read every OPEN folder and fold the answers into the children cache.
   *
   * This is what makes a refresh see a change INSIDE an expanded folder: the
   * root listing never carries a folder's children, so without it the cache
   * would keep answering with the tree as it was when the folder was expanded.
   *
   * A folder whose read no longer answers is gone: its cache entry is dropped
   * and it leaves the expansion set, so a deleted branch cannot come back and
   * is not asked about again on every refresh.
   */
  const syncOpenFolders = async (requested: string): Promise<void> => {
    const paths = [...expandedPathsRef.current];
    if (paths.length === 0) return;
    const reads = await Promise.all(
      paths.map(async (path) => ({ path, read: await readDir(listUrl(path)) })),
    );
    if (scopeRef.current !== requested) return;
    const vanished: string[] = [];
    for (const { path, read } of reads) {
      if (read.status === 'ok') childrenCacheRef.current[path] = read.files;
      else if (read.status === 'missing') vanished.push(path);
      // `failed` says nothing about the folder: a dropped request must not
      // collapse a branch the user has open.
    }
    if (vanished.length === 0) return;
    const gone = new Set(vanished);
    for (const path of vanished) delete childrenCacheRef.current[path];
    const remaining = new Set([...expandedPathsRef.current].filter((path) => !gone.has(path)));
    expandedPathsRef.current = remaining;
    onExpansionPruned(remaining);
  };

  const reload = async (): Promise<void> => {
    if (!enabled) return;
    const requested = scopeRef.current;
    setIsLoading(true);
    try {
      const read = await readDir(listUrl());
      if (scopeRef.current !== requested) return;
      // A root read that did not answer leaves the previous tree on screen
      // rather than blanking the panel over a transient failure.
      if (read.status !== 'ok') return;
      // Children cached under the previous tree are keyed by paths relative to
      // a root that is not this one: drop them before rehydrating.
      if (listedScopeRef.current !== requested) childrenCacheRef.current = {};
      rootFilesRef.current = read.files;
      // The fresh root paints immediately; the open folders follow, so a slow
      // child read cannot hold the whole tree back.
      commit(requested, read.root);
      await syncOpenFolders(requested);
      if (scopeRef.current !== requested) return;
      commit(requested, read.root);
    } finally {
      if (scopeRef.current === requested) setIsLoading(false);
    }
  };

  const loadChildren = async (path: string): Promise<void> => {
    const requested = scopeRef.current;
    const read = await readDir(listUrl(path));
    if (scopeRef.current !== requested || read.status !== 'ok') return;
    childrenCacheRef.current[path] = read.files;
    setState((prev) => (prev.scope === requested
      ? { ...prev, files: setChildrenAt(prev.files, path, read.files) }
      : prev));
  };

  const adoptRoot = (data: unknown): void => {
    const read = readDirPayload(data);
    if (read.status !== 'ok') return;
    const requested = scopeRef.current;
    if (listedScopeRef.current !== requested) childrenCacheRef.current = {};
    rootFilesRef.current = read.files;
    commit(requested, read.root);
    void syncOpenFolders(requested).then(() => {
      if (scopeRef.current === requested) commit(requested, read.root);
    });
  };

  const reset = (): void => {
    childrenCacheRef.current = {};
    rootFilesRef.current = [];
    listedScopeRef.current = '';
    listedRootRef.current = '';
    setState({ scope: '', files: [], root: '' });
  };

  /**
   * The tree edits below patch the same two sources a read fills — the root
   * list and the children cache — and then commit, so `rehydrateTree` remains
   * the only thing that builds what is rendered. Editing the rendered tree
   * directly would be undone by the next commit, which rebuilds from these.
   */
  const insertEntry = (entry: { path: string; kind: 'file' | 'folder' }): void => {
    const requested = scopeRef.current;
    if (listedScopeRef.current !== requested) return;
    const node: FsNode = {
      name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
      path: entry.path,
      type: entry.kind,
      ignored: false,
    };
    const placed = placeEntry(rootFilesRef.current, childrenCacheRef.current, node);
    if (placed.nodes === rootFilesRef.current) return;
    rootFilesRef.current = placed.nodes;
    childrenCacheRef.current = placed.cache;
    commit(requested, listedRootRef.current);
  };

  const moveEntry = (fromPath: string, toPath: string): void => {
    const requested = scopeRef.current;
    if (listedScopeRef.current !== requested) return;
    const taken = takeEntry(rootFilesRef.current, childrenCacheRef.current, fromPath);
    if (!taken.entry) return;
    childrenCacheRef.current = rekeyCache(taken.cache, fromPath, toPath);
    const moved: FsNode = { ...taken.entry, path: toPath, name: toPath.slice(toPath.lastIndexOf('/') + 1) };
    const placed = placeEntry(taken.nodes, childrenCacheRef.current, moved);
    rootFilesRef.current = placed.nodes;
    childrenCacheRef.current = placed.cache;
    commit(requested, listedRootRef.current);
  };

  // A listing read for another scope is not this one's to render: the panel
  // shows an empty tree until the current scope's read lands.
  const current = state.scope === scope;
  return {
    scope,
    files: current ? state.files : [],
    root: current ? state.root : '',
    isLoading,
    reload,
    loadChildren,
    adoptRoot,
    insertEntry,
    moveEntry,
    reset,
  };
}
