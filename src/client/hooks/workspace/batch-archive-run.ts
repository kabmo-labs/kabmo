/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The state behind a batch archive, shared by both sidebars.
 *
 * Archive is reversible, so there is no confirmation dialog and no pending set
 * to hold: the bar's Archive acts on the live selection and the run only has to
 * report in-flight state (the button spins) and republish the sidebar ONCE,
 * from the server's own signal, after any row actually moved. The caller
 * decides what to say about the settled outcome, because the toast stack is
 * per-layout.
 *
 * Workspaces have no archive state — archive is a session noun — so this is
 * session-mode only.
 */

import { useCallback, useState } from 'preact/hooks';
import {
  archiveSessionsBatch,
  type BatchArchiveOutcome,
} from '@/client/hooks/workspace/batch-archive';

export interface BatchArchiveRun {
  isArchiving: boolean;
  /** Archive these ids. Resolves with the settled outcome (null when nothing ran). */
  archive: (ids: readonly string[]) => Promise<BatchArchiveOutcome | null>;
}

export function useBatchArchiveRun(refresh: () => void): BatchArchiveRun {
  const [isArchiving, setIsArchiving] = useState(false);

  const archive = useCallback(async (ids: readonly string[]): Promise<BatchArchiveOutcome | null> => {
    if (ids.length === 0 || isArchiving) return null;
    setIsArchiving(true);
    const result = await archiveSessionsBatch(ids);
    // One refresh for the whole batch: the server emits `sidebar-structure`
    // once, and only when something actually archived.
    if (result.archived.length > 0) refresh();
    setIsArchiving(false);
    return result;
  }, [isArchiving, refresh]);

  return { isArchiving, archive };
}
