/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The worktree a pending chat picked, as a ref the SEND path can read.
 *
 * The composer is remounted by a stretch, a tab switch and a reload, while the
 * send handler is created once per deps record — so a pick read from render
 * state there would be missed, which is the one outcome the pick exists to
 * prevent. The persisted copy is `chat.spawnTarget` (it survives a reload, and
 * a second tab sees it); the ref is its render-visible mirror.
 *
 * Same shape as the waiting pick's ref (`waiting/choice.ts`), for the same
 * reason: a value written before the send and read at send time cannot travel
 * through props that rebuild.
 */

import { useEffect, useRef } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state/index';

/** Where the chat that has not started will run. */
export interface SpawnTarget {
  folderId: number | null;
  /** Absolute worktree path, or null for the folder's own checkout. */
  worktreePath: string | null;
}

/** `chat.spawnTarget` — the persisted pick, shared by both layouts' composers. */
export const SPAWN_TARGET_KEY = 'chat.spawnTarget';

export interface SpawnTargetBinding {
  /** The pick, for a control that draws it (the composer's target picker). */
  target: SpawnTarget | null;
  setTarget: (next: SpawnTarget | null) => void;
  /** The send path's view: set before the request goes out. */
  worktreePathRef: { current: string | null };
}

export function useSpawnTarget(sessionId: string | null): SpawnTargetBinding {
  const [target, setTarget] = useSessionState<SpawnTarget | null>(SPAWN_TARGET_KEY, null);
  const worktreePathRef = useRef<string | null>(null);

  useEffect(() => {
    // A pick for ANOTHER session must not leak into this one: the store is keyed
    // by session, so a change of session id re-reads and this effect re-mirrors.
    worktreePathRef.current = target?.worktreePath ?? null;
  }, [target, sessionId]);

  return { target, setTarget, worktreePathRef };
}