/**
 * Client-side trigger for the server's prewarm pool: asking Kabmo server
 * to start an idle `omp --mode rpc-ui` process for a project cwd before the
 * first prompt is sent. Fired when the user opens a new (pending) session —
 * the seconds between the click and the first send then hide the omp boot.
 *
 * Fire-and-forget by contract: a failed or slow prewarm must never block or
 * error the UI. The next send spawns cold in that case, exactly as before.
 */

export function triggerSessionPrewarm(cwd: string, accessMode?: string): void {
  if (!cwd) return;
  fetch('/api/agent/prewarm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, ...(accessMode ? { accessMode } : {}) }),
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
): string | null {
  const target = folderId !== undefined
    ? folders.find((f) => String(f.id) === String(folderId))
    : folders.find((f) => f.sessions?.some((s) => String(s.id) === String(activeSessionId)))
      ?? folders.find((f) => Boolean(f.project_path));
  return target?.project_path || target?.name || null;
}
