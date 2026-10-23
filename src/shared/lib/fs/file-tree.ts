import type { FsNode } from '@/shared/types';

/** Replace the children of the node at `path`, rebuilding only that branch. */
export function setChildrenAt(nodes: FsNode[], path: string, children: FsNode[]): FsNode[] {
  return nodes.map(node => {
    if (node.path === path) return { ...node, children };
    if (Array.isArray(node.children)) {
      const nested = setChildrenAt(node.children, path, children);
      if (nested !== node.children) return { ...node, children: nested };
    }
    return node;
  });
}

/**
 * Re-attach the children already loaded for a folder, so a re-listing of the
 * same tree does not collapse what the user had open.
 *
 * Which folders are open is the caller's `expandedPaths` set, keyed by paths
 * RELATIVE to the listed root — which is why the caller must drop both that set
 * and the cache when the listed root changes: `src/` under one workspace would
 * otherwise rehydrate into `src/` under the next.
 */
export function rehydrateTree(nodes: FsNode[], cache: Record<string, FsNode[]>): FsNode[] {
  return nodes.map(node => {
    if (node.type !== 'folder') return node;
    const cached = cache[node.path];
    if (!cached) return node;
    return { ...node, children: rehydrateTree(cached, cache) };
  });
}

/** The folder a path lives in: `.` for a top-level entry. */
export function parentPathOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut);
}

/** The last segment of a path. */
export function baseNameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The server's own ordering (`lib/fs/listing.ts`): folders first, then by name.
 *
 * A locally inserted row has to land where the server would have put it, or the
 * next real read would visibly reorder the tree under the user.
 */
export function sortEntries(nodes: FsNode[]): FsNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** The listing after a local edit: the root list plus the children cache. */
export interface TreeEdit {
  nodes: FsNode[];
  cache: Record<string, FsNode[]>;
}

/**
 * Insert `entry` where its own path says it belongs, creating the folder chain
 * that leads to it when the tree does not carry it yet.
 *
 * This is what lets a create and a rename skip a reload: the panel already
 * knows the whole answer, and re-reading the root plus every open folder to
 * learn it back would collapse nothing but cost a request per open folder.
 *
 * A chain is only extended through folders whose children are KNOWN — the root
 * list plus the cache. A collapsed folder's contents are not this tree's to
 * guess at, so an entry created inside one is simply not inserted: expanding it
 * reads the real directory, which by then holds the new entry. The chain nodes
 * that ARE inserted carry no `children` array, so the row's own expand effect
 * reads them from disk like any other unread folder.
 */
export function placeEntry(nodes: FsNode[], cache: Record<string, FsNode[]>, entry: FsNode): TreeEdit {
  const segments = entry.path.split('/');
  const nextNodes = [...nodes];
  const nextCache = { ...cache };
  let container = nextNodes;
  let containerKey: string | null = null;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const folderPath = segments.slice(0, i + 1).join('/');
    const existing = container.find((node) => node.path === folderPath);
    const known = existing ? (nextCache[folderPath] ?? existing.children) : null;
    if (existing && !Array.isArray(known)) return { nodes, cache };
    const children = Array.isArray(known) ? [...known] : [];
    if (!existing) container.push({ name: segments[i], path: folderPath, type: 'folder', ignored: false });
    nextCache[folderPath] = children;
    container = children;
    containerKey = folderPath;
  }

  container.push(entry);
  if (containerKey !== null) nextCache[containerKey] = sortEntries(container);
  return { nodes: sortEntries(nextNodes), cache: nextCache };
}

/**
 * Remove the entry at `path` from wherever it lives, leaving the rest of the
 * tree untouched. Returns `entry: null` when the path is not in this tree —
 * a collapsed folder's contents are not, and that is not an error.
 */
export function takeEntry(
  nodes: FsNode[],
  cache: Record<string, FsNode[]>,
  path: string,
): TreeEdit & { entry: FsNode | null } {
  const parent = parentPathOf(path);
  if (parent === '.') {
    const entry = nodes.find((node) => node.path === path) ?? null;
    if (!entry) return { entry: null, nodes, cache };
    return { entry, nodes: nodes.filter((node) => node.path !== path), cache };
  }
  const siblings = cache[parent];
  const entry = siblings?.find((node) => node.path === path) ?? null;
  if (!entry || !siblings) return { entry: null, nodes, cache };
  return {
    entry,
    nodes,
    cache: { ...cache, [parent]: siblings.filter((node) => node.path !== path) },
  };
}

/**
 * Re-point one entry and every path beneath it at a new location.
 *
 * A folder's descendants carry their parent's path as a prefix, so moving the
 * folder without rewriting them would leave every child pointing at the old
 * tree — a row whose `path` no longer resolves, and an expansion set keyed by
 * names that are gone.
 *
 * A branch that does not hold the moved path is returned AS IS: the arrays are
 * what React diffs, and a rename that rebuilt every unrelated subtree would
 * re-render the whole tree for a change it did not touch.
 */
export function renameEntryAt(nodes: FsNode[], fromPath: string, toPath: string): FsNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    const isMoved = node.path === fromPath || node.path.startsWith(`${fromPath}/`);
    const nested = Array.isArray(node.children) ? renameEntryAt(node.children, fromPath, toPath) : undefined;
    // `nested === node.children` holds for a file (`undefined`) and for a folder
    // whose subtree did not move, so an untouched row keeps its identity.
    if (!isMoved && nested === node.children) return node;
    changed = true;
    const path = isMoved ? (node.path === fromPath ? toPath : `${toPath}${node.path.slice(fromPath.length)}`) : node.path;
    const renamed: FsNode = isMoved ? { ...node, path, name: baseNameOf(path) } : { ...node };
    if (nested !== undefined) renamed.children = nested;
    return renamed;
  });
  return changed ? next : nodes;
}

/**
 * Move every cache entry under `fromPath` to `toPath`, paths included.
 *
 * An entry outside the move keeps its own array identity, for the reason
 * `renameEntryAt` does: those arrays are what the tree diffs.
 */
export function rekeyCache(
  cache: Record<string, FsNode[]>,
  fromPath: string,
  toPath: string,
): Record<string, FsNode[]> {
  const next: Record<string, FsNode[]> = {};
  for (const [key, children] of Object.entries(cache)) {
    const moved = key === fromPath
      ? toPath
      : key.startsWith(`${fromPath}/`)
        ? `${toPath}${key.slice(fromPath.length)}`
        : key;
    next[moved] = moved === key ? children : renameEntryAt(children, fromPath, toPath);
  }
  return next;
}

/** Rewrite the expansion set for a renamed folder, so open branches stay open. */
export function rekeyExpansion(expanded: Set<string>, fromPath: string, toPath: string): Set<string> {
  const next = new Set<string>();
  for (const path of expanded) {
    if (path === fromPath) next.add(toPath);
    else if (path.startsWith(`${fromPath}/`)) next.add(`${toPath}${path.slice(fromPath.length)}`);
    else next.add(path);
  }
  return next;
}
