/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's COLLAPSED folder chains.
 *
 * A folder that holds exactly one folder and nothing else is drawn as a single
 * row naming the whole chain (`com/java/app/package`), because a row per
 * directory level spends four rows to reach the files inside and every editor
 * folds that. The server collapses the same chains when it lists a directory
 * (`folderChain`, `lib/fs/listing.ts`); this half exists for the trees the
 * CLIENT builds — a create or a rename inserts a chain the server has not
 * listed yet — and it is applied by `rehydrateTree`, which is the one function
 * that builds a rendered tree.
 *
 * Split from `file-tree.ts` (which owns the edits) because the two rules are
 * read by different callers: the panel's listing hook needs the fold and the
 * reveal, while the create/rename paths need the placement.
 */

import type { FsNode } from '@/shared/types';

/**
 * Collapse a folder that holds exactly one FOLDER and nothing else into that
 * child, so one row names the whole chain.
 *
 * The folded row's IDENTITY is the deepest directory — that is what its
 * children are, what an expand reads, and what a rename, delete or drag acts
 * on. Only its `name` carries the chain, so the label says where the row is.
 *
 * A folder whose children are NOT loaded cannot fold: the client does not know
 * whether it holds one folder or forty files, and guessing would hide a listing
 * the server never produced.
 */
export function foldSingleChildFolders(nodes: FsNode[]): FsNode[] {
  const next = nodes.map(foldNode);
  // Identity is what the row components diff on, so an unchanged list keeps its
  // own array rather than re-rendering every row on every commit.
  return next.some((node, index) => node !== nodes[index]) ? next : nodes;
}

function foldNode(node: FsNode): FsNode {
  if (node.type !== 'folder' || !Array.isArray(node.children)) return node;
  const children = foldSingleChildFolders(node.children);
  let current: FsNode = children === node.children ? node : { ...node, children };
  while (Array.isArray(current.children) && current.children.length === 1) {
    const only = current.children[0];
    if (only.type !== 'folder') break;
    current = {
      ...current,
      name: `${current.name}/${only.name}`,
      path: only.path,
      children: only.children,
      // The row names the deepest directory now, so that is the one whose
      // git-ignore answer it wears (a rule matching an outer level matches it
      // too — verified against `git check-ignore`).
      ignored: only.ignored ?? current.ignored,
    };
  }
  return current;
}

/**
 * Whether this row is a folded chain — one row standing for several directories.
 *
 * Decided by the LABEL alone, and that is load-bearing in both directions: a
 * directory name cannot contain a separator, so a `/` in a folder's `name` can
 * only come from the fold. Comparing `name` with `path` does not work, because a
 * chain folded at the listing's own root is labelled with the whole path
 * (`name === path === 'dev/src/main/code'`) while still standing for four
 * directories — every surface that asks "does this row hide levels?" (drop
 * targets, the rename and delete dialogs, the unfold menu row) reads this one
 * answer, so they cannot disagree about the same row.
 */
export function isChainRow(node: { type: 'file' | 'folder'; name: string }): boolean {
  return node.type === 'folder' && node.name.includes('/');
}

/**
 * The paths of the directories a collapsed row STANDS FOR, outermost first —
 * or null when the row's label does not name a chain.
 *
 * The fold is a RENDERING decision, not a filesystem fact, and it hides
 * destinations: `dev/src/main` is not a row, so it cannot be dropped on,
 * renamed, or created inside — a drop on the one row lands in the deepest
 * directory (`code`) instead. The panel keeps a set of chains the user asked to
 * unfold and projects it onto the tree the listing hands over
 * (`unfoldChains`), and this is the one place that turns the row's LABEL
 * (`dev/src/main/code`) plus its `path` (the deepest directory) back into the
 * levels between them.
 */
export function chainLevelPaths(path: string, label: string): string[] | null {
  const names = label.split('/');
  const segments = path.split('/');
  if (names.length < 2 || names.length > segments.length || names.some((name) => !name)) return null;
  const outer = segments.slice(0, segments.length - names.length);
  return names.map((_, index) => [...outer, ...names.slice(0, index + 1)].join('/'));
}

/**
 * Drawn rows with the chains named in `unfolded` split back into one row per
 * directory, so every level of a folded chain becomes a real drop target, a
 * real rename target and a real place to create something.
 *
 * The deepest row keeps its own `children` — and therefore its own read — so
 * unfolding a chain never costs a request. Whether the intermediate rows are
 * DRAWN open is the panel's business, not this projection's: they are ordinary
 * rows, opened through the panel's expansion set like any other folder.
 */
export function unfoldChains(nodes: FsNode[], unfolded: ReadonlySet<string>): {
  nodes: FsNode[];
  /** The outermost level of each chain that was actually unfolded → its deepest path. */
  roots: Map<string, string>;
} {
  const roots = new Map<string, string>();
  if (unfolded.size === 0) return { nodes, roots };
  let changed = false;
  const walk = (list: FsNode[]): FsNode[] => list.flatMap((node) => {
    if (node.type !== 'folder') return [node];
    const children = Array.isArray(node.children) ? walk(node.children) : node.children;
    const row: FsNode = children === node.children ? node : { ...node, children };
    const levels = unfolded.has(node.path) ? chainLevelPaths(node.path, node.name) : null;
    if (!levels) return [row];
    changed = true;
    roots.set(levels[0]!, node.path);
    // Rebuilt from the outside in, so the deepest row is the original one —
    // its children, its expansion state and its git answer all stay attached.
    let deepest: FsNode = { ...row, name: levels[levels.length - 1]!.split('/').pop()! };
    for (let depth = levels.length - 1; depth > 0; depth -= 1) {
      const path = levels[depth - 1]!;
      deepest = {
        name: path.split('/').pop()!,
        path,
        type: 'folder',
        // A rule matching any level of the chain answers for the deepest too
        // (see `foldNode`), so every level wears the row's own answer.
        ignored: row.ignored,
        children: [deepest],
      };
    }
    return [deepest];
  });
  const next = walk(nodes);
  return { nodes: changed ? next : nodes, roots };
}

/**
 * The paths of the DRAWN rows that contain `path`, outermost first.
 *
 * This is what a reveal expands. It cannot be the path's own segments: a
 * collapsed chain is one row whose path is the deepest directory, so `lib` and
 * `lib/deep` are not rows at all — expanding them would leave the expansion set
 * holding paths nothing draws, which the next refresh then re-reads from disk
 * for nothing.
 */
export function drawnAncestors(nodes: FsNode[], path: string): string[] {
  const folders = new Set<string>();
  const walk = (list: FsNode[]) => {
    for (const node of list) {
      if (node.type !== 'folder') continue;
      folders.add(node.path);
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(nodes);
  const segments = path.split('/').slice(0, -1);
  const ancestors: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const prefix = segments.slice(0, i + 1).join('/');
    if (folders.has(prefix)) ancestors.push(prefix);
  }
  return ancestors;
}
