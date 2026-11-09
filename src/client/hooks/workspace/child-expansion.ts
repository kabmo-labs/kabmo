/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which session rows have their child tree open.
 *
 * Deliberately separate from `useExpandedSessions` (the subagent roster): one
 * chevron cannot mean two different lists. Local, not persisted — a collapsed
 * tree is one click away, while a persisted roster is what the phone and the
 * desktop must agree on.
 */

import { useCallback, useState } from 'preact/hooks';

export interface ChildExpansion {
  expandedChildIds: Set<string>;
  toggleChild: (sessionId: string) => void;
}

export function useChildExpansion(): ChildExpansion {
  const [expandedChildIds, setExpandedChildIds] = useState<Set<string>>(() => new Set());
  const toggleChild = useCallback((sessionId: string) => {
    setExpandedChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);
  return { expandedChildIds, toggleChild };
}
