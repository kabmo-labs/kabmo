/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The collapsed folder chains the reader has UNFOLDED, and the expansion that
 * makes the levels they expose visible.
 *
 * A chain row (`dev/src/main/code`) stands for four directories but is one row,
 * so the three levels inside its label have no row: they cannot be dropped on,
 * renamed, or created inside, and a drop on the one row lands in the deepest
 * directory instead. Unfolding turns each level back into a row of its own
 * (`unfoldChains` renders that projection), and this hook owns the set the
 * projection reads plus the three halves that make it usable:
 *
 * - **The levels are OPENED**, because a row that hid the level below it would
 *   hide the destination one step further down. They are ordinary folders whose
 *   children are already projected, so opening them reads nothing.
 * - **It is an explicit decision, reversed by Fold.** A hover that unfolded
 *   does not refold on its own — folding is what CLOSES the levels, so doing it
 *   silently would take a branch away from someone midway through a drag.
 * - **It is keyed by the chain's DEEPEST path**, the identity the listing gives
 *   the row. A rename re-points that key and every level with it, so an
 *   unfolded chain stays unfolded across the rename instead of drawing rows at
 *   addresses that no longer exist.
 *
 * The set is tagged with the listing scope it was made in, the way every other
 * path this panel caches is: paths are relative to the listed root, so a chain
 * unfolded in one repository must not unfold a same-named row in the next.
 */

import { useCallback, useState } from 'preact/hooks';
import { chainLevelPaths } from '@/shared/lib/fs/folder-chain';
import type { ClipboardTarget } from '@/client/hooks/workspace/file-clipboard';

/** The unfolded chains of one listing: deepest path → every level of the chain. */
interface UnfoldedChainsState {
  scope: string;
  chains: Map<string, string[]>;
}

/** A chain nothing has unfolded — the answer for every scope not yet touched. */
const NO_CHAINS: ReadonlySet<string> = new Set();

export interface UnfoldedChainsDeps {
  /** The listing scope (`root\0repo`) this set belongs to. */
  scope: string;
  setExpandedPaths: (updater: (prev: Set<string>) => Set<string>) => void;
  setStoredExpandedPaths: (value: string[]) => void;
}

export interface UnfoldedChains {
  /** The chain rows (by their deepest path) drawn as one row per directory. */
  unfolded: ReadonlySet<string>;
  /** Unfold the chain `target` names; a plain folder is left alone. */
  unfold: (target: ClipboardTarget) => void;
  /** Fold the chain identified by its deepest path back into the one row it is listed as. */
  fold: (deepestPath: string) => void;
  /** Re-point an unfolded chain at a renamed row, so it stays unfolded. */
  rekey: (fromPath: string, toPath: string) => void;
}

export function useUnfoldedChains({ scope, setExpandedPaths, setStoredExpandedPaths }: UnfoldedChainsDeps): UnfoldedChains {
  const [state, setState] = useState<UnfoldedChainsState>({ scope, chains: new Map() });

  const unfold = useCallback((target: ClipboardTarget) => {
    const levels = chainLevelPaths(target.path, target.name);
    if (!levels) return;
    setState((prev) => {
      const chains = prev.scope === scope ? prev.chains : new Map<string, string[]>();
      // `dragover` fires on every pointer move, so the repeat has to cost
      // nothing at all — not a new Map, not a render.
      const known = chains.get(target.path);
      if (known?.length === levels.length) return prev;
      const next = new Map(chains);
      next.set(target.path, levels);
      return { scope, chains: next };
    });
    const exposed = levels.slice(0, -1);
    setExpandedPaths((prev) => {
      if (exposed.every((folder) => prev.has(folder))) return prev;
      const next = new Set(prev);
      for (const folder of exposed) next.add(folder);
      setStoredExpandedPaths(Array.from(next));
      return next;
    });
  }, [scope, setExpandedPaths, setStoredExpandedPaths]);

  /**
   * Folding also CLOSES the levels it exposed: the chain row hides them again,
   * so leaving them in the expansion set would have the next refresh read each
   * of them from disk to fill in rows nothing draws.
   */
  const fold = useCallback((deepestPath: string) => {
    const levels = state.scope === scope ? state.chains.get(deepestPath) : undefined;
    if (!levels) return;
    const exposed = levels.slice(0, -1);
    setState((prev) => {
      if (prev.scope !== scope) return prev;
      const next = new Map(prev.chains);
      next.delete(deepestPath);
      return { scope, chains: next };
    });
    setExpandedPaths((prev) => {
      if (!exposed.some((folder) => prev.has(folder))) return prev;
      const next = new Set(prev);
      for (const folder of exposed) next.delete(folder);
      setStoredExpandedPaths(Array.from(next));
      return next;
    });
  }, [scope, state, setExpandedPaths, setStoredExpandedPaths]);

  /**
   * A chain whose row was renamed keeps its unfold — unless the rename split the
   * chain apart.
   *
   * A chain is a run of contiguous single-child directories, so only two renames
   * preserve it: one of a level ABOVE the chain (every level shifts by the same
   * prefix) and one of its DEEPEST directory (only the last level moves). A
   * rename of a level in BETWEEN leaves `dev/` holding nothing and
   * `dev2/src/main/` holding the rest, which is no longer one row — the entry is
   * dropped rather than re-pointed at a chain that does not exist. The exposed
   * levels are re-opened by name, because the expansion set is keyed by path and
   * the rows that were open just moved.
   */
  const rekey = useCallback((fromPath: string, toPath: string) => {
    const chains = state.scope === scope ? state.chains : null;
    if (!chains) return;
    const next = new Map<string, string[]>();
    const exposed: string[] = [];
    let changed = false;
    for (const [deepest, levels] of chains) {
      const interior = levels.findIndex((path, index) => path === fromPath && index > 0 && index < levels.length - 1);
      if (interior !== -1) {
        changed = true;
        continue;
      }
      const moved = levels.map((path) => path === fromPath
        ? toPath
        : path.startsWith(`${fromPath}/`) ? `${toPath}${path.slice(fromPath.length)}`
          : path);
      const nextDeepest = moved[moved.length - 1]!;
      if (nextDeepest !== deepest || moved.some((path, index) => path !== levels[index])) changed = true;
      next.set(nextDeepest, moved);
      exposed.push(...moved.slice(0, -1));
    }
    if (!changed) return;
    setState({ scope, chains: next });
    setExpandedPaths((prev) => {
      if (exposed.every((folder) => prev.has(folder))) return prev;
      const nextExpanded = new Set(prev);
      for (const folder of exposed) nextExpanded.add(folder);
      setStoredExpandedPaths(Array.from(nextExpanded));
      return nextExpanded;
    });
  }, [scope, state, setExpandedPaths, setStoredExpandedPaths]);

  return {
    unfolded: state.scope === scope && state.chains.size > 0 ? new Set(state.chains.keys()) : NO_CHAINS,
    unfold,
    fold,
    rekey,
  };
}
