import type { FsNode } from '@/shared/types';
import { foldSingleChildFolders } from '@/shared/lib/fs/folder-chain';

/**
 * Re-attach the children already loaded for a folder, so a re-listing of the
 * same tree does not collapse what the user had open.
 *
 * Which folders are open is the caller's `expandedPaths` set, keyed by paths
 * RELATIVE to the listed root — which is why the caller must drop both that set
 * and the cache when the listed root changes: `src/` under one workspace would
 * otherwise rehydrate into `src/` under the next.
 *
 * The fold runs HERE because this is the one function that builds a rendered
 * tree — every server read, every realtime snapshot and every local edit goes
 * through it. Folding at a call site instead would let a create draw a tree the
 * next read undoes.
 */
export function rehydrateTree(nodes: FsNode[], cache: Record<string, FsNode[]>): FsNode[] {
  return foldSingleChildFolders(nodes.map(node => rehydrateNode(node, cache)));
}

function rehydrateNode(node: FsNode, cache: Record<string, FsNode[]>): FsNode {
  if (node.type !== 'folder') return node;
  const cached = cache[node.path];
  if (!cached) return node;
  return { ...node, children: rehydrateTree(cached, cache) };
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
 *
 * A row may already stand for a CHAIN of directories (`lib/deep`), because a
 * single-child folder is collapsed — by the server when it lists, and by
 * `rehydrateTree` for the chains this function creates. Descending into that
 * row by its own path is what keeps a create from inserting a SECOND row for a
 * directory the tree already draws; a chain row that covers the destination but
 * is not the destination itself is skipped, so `lib/other/x.ts` never lands
 * inside `lib/deep`.
 */
export function placeEntry(nodes: FsNode[], cache: Record<string, FsNode[]>, entry: FsNode): TreeEdit {
  const segments = entry.path.split('/');
  const parentPath = segments.slice(0, -1).join('/');
  let nextNodes = [...nodes];
  const nextCache = { ...cache };
  let container = nextNodes;
  let containerKey: string | null = null;

  for (let i = 0; i < segments.length - 1;) {
    const folderPath = segments.slice(0, i + 1).join('/');
    const existing = container.find((node) => node.type === 'folder' && node.path === folderPath);
    const chain = existing ? null : container.find((node) => node.type === 'folder'
      && node.path.startsWith(`${folderPath}/`)
      && (parentPath === node.path || parentPath.startsWith(`${node.path}/`)));
    const node = existing ?? chain;
    const known = node ? (nextCache[node.path] ?? node.children) : null;
    if (node && !Array.isArray(known)) return { nodes, cache };
    if (!node) {
      // No row names `folderPath`, but a collapsed chain row may still STAND for
      // it (`lib/deep` while the entry is `lib/other/x.ts`). Inserting a fresh
      // `lib` beside it would draw `deep` twice — once inside the new row and
      // once as its own — so the chain is unfolded back into the rows the
      // server would list: `lib` holding `deep`, whose children stay in the
      // cache under their unchanged paths.
      const unfolded = unfoldRow(container, nextCache, folderPath);
      if (unfolded) {
        container = unfolded;
        const top = container.find((node) => node.path === folderPath);
        const children = Array.isArray(top?.children) ? [...top.children] : [];
        nextCache[folderPath] = children;
        container = children;
        containerKey = folderPath;
        i += 1;
        continue;
      }
    }
    const children = Array.isArray(known) ? [...known] : [];
    if (node) {
      nextCache[node.path] = children;
      container = children;
      containerKey = node.path;
      // The row names every directory of its chain, so the walk resumes past
      // all of them rather than re-deriving a folder that is already drawn.
      i = node.path.split('/').length;
      continue;
    }
    container.push({ name: segments[i], path: folderPath, type: 'folder', ignored: false });
    nextCache[folderPath] = children;
    container = children;
    containerKey = folderPath;
    i += 1;
  }

  container.push(entry);
  if (containerKey !== null) nextCache[containerKey] = sortEntries(container);
  nextNodes = sortEntries(nextNodes);
  return { nodes: nextNodes, cache: nextCache };
}

/**
 * Replace a collapsed chain row with the rows the server would list for it.
 *
 * `folderPath` names the OUTERMOST directory of the chain, so the row is
 * rebuilt as that directory holding the rest of the chain one level at a time.
 * Mutates `container` in place (the caller owns a copy) and returns it, or
 * `null` when no row in it stands for `folderPath`.
 */
function unfoldRow(container: FsNode[], cache: Record<string, FsNode[]>, folderPath: string): FsNode[] | null {
  const index = container.findIndex((node) => node.type === 'folder' && node.path.startsWith(`${folderPath}/`));
  if (index === -1) return null;
  const row = container[index]!;
  const rest = row.path.slice(folderPath.length + 1).split('/');
  const deepestChildren = cache[row.path] ?? row.children;
  if (Array.isArray(deepestChildren)) cache[row.path] = deepestChildren;
  let built: FsNode = {
    name: rest[rest.length - 1]!,
    path: row.path,
    type: 'folder',
    ignored: row.ignored,
    ...(Array.isArray(deepestChildren) ? { children: deepestChildren } : {}),
  };
  for (let i = rest.length - 2; i >= 0; i -= 1) {
    built = {
      name: rest[i]!,
      path: `${folderPath}/${rest.slice(0, i + 1).join('/')}`,
      type: 'folder',
      ignored: false,
      children: [built],
    };
  }
  // The outermost row is the directory the entry needed, holding the chain
  // beneath it — its own name and path, so a later step finds it by
  // `folderPath`, and the chain's leaf keeps its own children.
  container[index] = { name: baseNameOf(folderPath), path: folderPath, type: 'folder', ignored: false, children: [built] };
  return container;
}

/**
 * Remove the entry at `path` from wherever it lives, leaving the rest of the
 * tree untouched. Returns `entry: null` when the path is not in this tree —
 * a collapsed folder's contents are not, and that is not an error.
 *
 * The search walks EVERY container rather than looking the parent up by path:
 * a collapsed chain row's own path is the deepest directory, so its parent key
 * is one the cache does not hold (`com/java/app/package` lives in `com/java`,
 * and no `com/java/app` key exists). Deriving the container from the path would
 * report a rename of that row as "not in this tree" and fall back to a reload.
 */
export function takeEntry(
  nodes: FsNode[],
  cache: Record<string, FsNode[]>,
  path: string,
): TreeEdit & { entry: FsNode | null } {
  const atRoot = nodes.find((node) => node.path === path);
  if (atRoot) return { entry: atRoot, nodes: nodes.filter((node) => node.path !== path), cache };
  // The container the server would have listed it in, when the tree holds it.
  const parent = parentPathOf(path);
  const direct = cache[parent];
  const directEntry = direct?.find((node) => node.path === path);
  if (direct && directEntry) {
    return { entry: directEntry, nodes, cache: { ...cache, [parent]: direct.filter((node) => node.path !== path) } };
  }
  // Otherwise the DEEPEST drawn container above it: a chain row's key is its
  // deepest directory, so its children live under a key the path's own parent
  // does not name.
  const candidates = Object.keys(cache)
    .filter((key) => path.startsWith(`${key}/`) && cache[key]!.some((node) => node.path === path))
    .sort((a, b) => b.length - a.length);
  const key = candidates[0];
  if (!key) return { entry: null, nodes, cache };
  const siblings = cache[key]!;
  return {
    entry: siblings.find((node) => node.path === path)!,
    nodes,
    cache: { ...cache, [key]: siblings.filter((node) => node.path !== path) },
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
