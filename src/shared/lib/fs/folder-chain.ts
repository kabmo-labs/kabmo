/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
