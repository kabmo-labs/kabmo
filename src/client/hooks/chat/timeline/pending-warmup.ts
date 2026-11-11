/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Warm the agent a PENDING chat will spawn on, and re-warm it when a pick that
 * decides the boot moves.
 *
 * The sidebar's New Session click already warms omp's RPC child, but it cannot
 * know which agent the chat will end up on: the harness is picked in the
 * composer, and a Plan pick changes the environment omp's child must start
 * with. Both are known here, and both are known BEFORE the first prompt — so
 * the boot happens while the prompt is being written instead of after it.
 *
 * One effect keyed by the facts that decide WHICH process is warmed. The server
 * recycles an entry that can no longer serve the request (a different approval
 * mode or mode selection for omp; a different harness for ACP), so a re-fire is
 * a replacement, not a second process.
 */

import { useEffect } from 'preact/hooks';
import { isPendingSessionId } from '@/shared/lib/omp/session/default-title';
import { triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';
import type { WorkspaceFolderData } from '@/shared/types';

export interface PendingWarmupInput {
  sessionId: string | null;
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  /** The worktree the draft picked, when it did — the spawn's real cwd. */
  worktreePath: string | null;
  /** The harness the chat will spawn on; absent means omp's RPC transport. */
  harness: string | undefined;
  /** The pending chat's Plan pick, which omp's child reads at start. */
  plan: boolean;
}

export function usePendingWarmup({
  sessionId,
  folders,
  selectedFolderId,
  worktreePath,
  harness,
  plan,
}: PendingWarmupInput): void {
  // The send path's own rule (`dispatchPendingChat`), read off the SAME field:
  // the worktree pick wins, then the selected folder's project path. Resolving
  // it any other way warms a process in a cwd the send never claims — a spawn
  // AND a kill for nothing.
  const pending = isPendingSessionId(sessionId);
  const folder = folders.find((row) => String(row.id) === String(selectedFolderId));
  const cwd = pending ? worktreePath ?? folder?.project_path ?? folder?.name ?? null : null;
  const key = `${cwd ?? ''}\u0000${harness ?? 'omp-rpc'}\u0000${plan ? 'plan' : ''}`;
  useEffect(() => {
    if (!cwd) return;
    triggerSessionPrewarm(cwd, { harness: harness ?? 'omp-rpc', modes: { plan, goal: false } });
    // `key` carries every input; a re-render that changed none of them must not
    // fire another prewarm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
