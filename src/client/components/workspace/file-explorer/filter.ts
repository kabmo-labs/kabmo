/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's filter: keep a node when its own name matches, or when a
 * descendant does.
 *
 * A matching FOLDER keeps its whole subtree (its name is the answer, and hiding
 * its contents would make the match useless), while a folder that only matches
 * through its children keeps just the children that do. Either way the row is
 * forced open, because a match inside a collapsed folder is a match the user
 * cannot see.
 *
 * Extracted from the panel so the render file stays under the line ceiling.
 */

import type { FsNode } from '@/shared/types';

export function filterFileTree(tree: FsNode[], query: string): FsNode[] {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) return tree;

  const filterNode = (node: FsNode): FsNode | null => {
    const isMatch = node.name.toLowerCase().includes(lowerQuery);

    if (node.type === 'folder') {
      const filteredChildren = (node.children || [])
        .map(filterNode)
        .filter((child): child is FsNode => child !== null);

      if (isMatch || filteredChildren.length > 0) {
        return {
          ...node,
          children: isMatch && filteredChildren.length === 0 ? node.children : filteredChildren,
          forceExpanded: true,
        };
      }
      return null;
    }

    return isMatch ? node : null;
  };

  return tree.map(filterNode).filter((node): node is FsNode => node !== null);
}
