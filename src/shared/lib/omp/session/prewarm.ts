/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client-side trigger for the server's prewarm pools: asking Kabmo server to
 * start an idle agent for a project cwd before the first prompt is sent.
 * Fired when the user opens a new (pending) session and whenever a pending
 * chat's harness or mode pick moves — the seconds between the click and the
 * first send then hide the boot.
 *
 * Fire-and-forget by contract: a failed or slow prewarm must never block or
 * error the UI. The next send spawns cold in that case, exactly as before.
 *
 * **The access mode is read here, from the live settings snapshot, and is
 * deliberately NOT a parameter.** `claimPrewarmedSession` only hands out an
 * entry spawned with the mode the send asks for; a mismatch KILLS the
 * prewarmed child and cold-spawns (measured: 762 ms against 6 ms), so the
 * prewarm exists only if both ends name the same mode. Callers cannot supply
 * it reliably: the desktop sidebar reads `appSettings.omp_access_mode`, a
 * boot-time prop, while the send path reads the composer's live ref — a mode
 * picked in the composer then spent the next prewarm on the previous one, and
 * the phone passed nothing at all, so every prewarm there was always-ask
 * against a yolo install. `writeSetting` updates the snapshot synchronously,
 * so this reads exactly what the composer last chose.
 *
 * **`harness` picks the POOL.** Only omp's RPC pool existed at first, so every
 * pending chat on an ACP agent paid that agent's full boot on its first prompt.
 * `modes` is the pending chat's Plan pick: omp's child reads it from its
 * start-time environment, so a warm child without it can never serve the chat.
 */

import { ACCESS_MODE_SETTING_KEY, isApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { readKabmoSetting } from '@/shared/lib/settings/client';

export interface PrewarmOptions {
  /** The harness the pending chat will spawn on. Absent means omp's RPC pool. */
  harness?: string | null;
  /** The pending chat's mode selection (omp only; ACP applies modes at spawn). */
  modes?: { plan: boolean; goal: boolean } | null;
}

export function triggerSessionPrewarm(cwd: string, options: PrewarmOptions = {}): void {
  if (!cwd) return;
  const stored = readKabmoSetting<unknown>(ACCESS_MODE_SETTING_KEY);
  const accessMode = isApprovalMode(stored) ? stored : undefined;
  const harness = options.harness || 'omp-rpc';
  fetch('/api/agent/prewarm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cwd,
      harness,
      ...(accessMode ? { accessMode } : {}),
      ...(options.modes ? { modes: options.modes } : {}),
    }),
  }).catch(() => {});
}

export interface PrewarmFolderShape {
  id: number | string;
  name: string;
  project_path?: string | null;
  sessions?: { id: number | string }[];
}

/** Resolve the folder whose context a new session will inherit — the folder
 *  owning the active session, falling back to the first bound folder. Matches
 *  the cwd resolution of the send path, so the prewarmed process is spawned in
 *  the directory the eventual spawn will actually use. */
export function spawnCwdForNewSession(
  folders: PrewarmFolderShape[],
  activeSessionId: string | number | null,
  folderId?: number | string,
  /**
   * A worktree the draft chose. It wins over the folder's project path, because
   * that is the whole point of picking one: the chat is born in the worktree and
   * nothing is ever relocated afterwards.
   */
  worktreePath?: string | null,
): string | null {
  if (worktreePath) return worktreePath;
  const target = folderId !== undefined
    ? folders.find((f) => String(f.id) === String(folderId))
    : folders.find((f) => f.sessions?.some((s) => String(s.id) === String(activeSessionId)))
      ?? folders.find((f) => Boolean(f.project_path));
  return target?.project_path || target?.name || null;
}
