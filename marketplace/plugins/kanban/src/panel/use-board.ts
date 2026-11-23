/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The board's client state: one read, one invalidation topic, one lens.
 *
 * The snapshot comes from `openBoard` and is re-read when the plugin's own topic
 * moves. The topic carries a REVISION, never the board, because two writers exist
 * — this panel and the MCP child an agent talks to — and the only thing the
 * panel can cheaply learn from another process is "something changed".
 *
 * The lens is per SESSION state (`useSessionState`), not component state: a
 * plugin panel is unmounted whenever another view is on screen, so a lens kept in
 * `useState` would reset every time the user glanced at Files.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { useRpc, useRealtime, useSessionState, usePanelInfo } from '@kabmo-labs/kabmo-ui';

import type { BoardRead, BoardSignal, CardSummary } from '../protocol';

/** The three lenses a board can show. `null` is the global bucket. */
export type Lens = 'all' | 'workspace' | 'unfiled';

/** Which cards the current lens keeps. */
export function lensCards(cards: readonly CardSummary[], lens: Lens, workspace: string | null): CardSummary[] {
  if (lens === 'workspace') return workspace ? cards.filter((card) => card.workspace === workspace) : [];
  if (lens === 'unfiled') return cards.filter((card) => card.workspace === null);
  return [...cards];
}

/** The lens a board opens on: this workspace when one is open, else everything. */
export function defaultLens(workspace: string | null): Lens {
  return workspace ? 'workspace' : 'all';
}

/** How many cards each lens holds, so the chips can say "9 elsewhere". */
export function lensCounts(cards: readonly CardSummary[], workspace: string | null): Record<Lens, number> {
  return {
    all: cards.length,
    workspace: workspace ? cards.filter((card) => card.workspace === workspace).length : 0,
    unfiled: cards.filter((card) => card.workspace === null).length,
  };
}

export interface BoardState {
  /** The board, or `{ exists: false }` when there is none yet. */
  snapshot: BoardRead | null;
  cards: CardSummary[];
  lens: Lens;
  setLens: (lens: Lens) => void;
  counts: Record<Lens, number>;
  isLoading: boolean;
  /** A read refusal, or the server's sentence when the board cannot be read. */
  error: string | null;
  /** True while the plugin topic says the value may be behind. */
  stale: boolean;
  reload: () => void;
  createBoard: () => Promise<void>;
  /** A write that answers the fresh snapshot, so the panel does not wait for the topic. */
  refreshAfter: <T>(work: () => Promise<T>) => Promise<T>;
}

/** Read the board, follow its topic, and keep the lens. */
export function useBoard(): BoardState {
  const { workspacePath } = usePanelInfo();
  const rpc = useRpc<Record<string, never>, BoardRead>('openBoard');
  const init = useRpc<Record<string, never>, BoardRead>('initBoard');
  const signal = useRealtime<BoardSignal>();
  const [snapshot, setSnapshot] = useState<BoardRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [storedLens, setStoredLens] = useSessionState<Lens | null>('kanban.lens', null);

  // A workspace is open → that lens; none → everything. A stored choice wins
  // only while it still names something, so a lens picked in one workspace does
  // not hide the board in a session that has no workspace at all.
  const lens: Lens = storedLens ?? defaultLens(workspacePath);
  const setLens = useCallback((next: Lens) => setStoredLens(next), [setStoredLens]);

  const read = useCallback(async () => {
    const outcome = await rpc.call({});
    if (outcome.ok) {
      // Absence is a value (`exists: false`), so this branch is the only place
      // the panel decides between the board and the Create screen.
      setSnapshot(outcome.value as BoardRead);
      setError(null);
    } else {
      setError(outcome.error.message);
    }
    setIsLoading(false);
  }, [rpc]);

  useEffect(() => {
    void read();
    // `read` is stable per method id; a mount is the only trigger here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The topic moves for THIS panel's writes and for an agent's (the watcher).
  useEffect(() => {
    if (!signal.value) return;
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal.value?.revision]);

  const createBoard = useCallback(async () => {
    const outcome = await init.call({});
    if (outcome.ok) {
      setSnapshot(outcome.value as BoardRead);
      setError(null);
    } else {
      setError(outcome.error.message);
    }
  }, [init]);

  const refreshAfter = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      const value = await work();
      await read();
      return value;
    },
    [read],
  );

  const boardCards = snapshot?.exists ? snapshot.cards : [];
  const cards = useMemo(() => lensCards(boardCards, lens, workspacePath), [boardCards, lens, workspacePath]);
  const counts = useMemo(
    () => lensCounts(boardCards, workspacePath),
    [boardCards, workspacePath],
  );

  return {
    snapshot,
    cards,
    lens,
    setLens,
    counts,
    isLoading,
    error,
    stale: signal.stale,
    reload: () => void read(),
    createBoard,
    refreshAfter,
  };
}
