/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared request→domain shaping for the schedule routes: the body guards, the
 * model snapshot normalizer and the folder→cwd resolution.
 *
 * The cwd is resolved HERE, at write time, and stored on the row: a task whose
 * folder is later deleted must still fire in the directory it was created for,
 * and a folder id alone would leave the runtime guessing (or falling back to
 * the server's own cwd, which is how a scheduled job silently starts running in
 * the wrong project).
 */

import { getDb } from '@/server/db.server';
import { normalizeModel } from '@/server/lib/queue/store.server';
import { readSettingsJson } from '@/server/lib/db/settings-store';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { isRecord } from '@/shared/lib/util/guards';
import type { ScheduleKind, ScheduledTaskModel } from '@/shared/types/schedule';

export const SCHEDULE_KINDS: readonly ScheduleKind[] = ['once', 'every', 'cron'];

/** `app_settings` key the model dropdown persists its pick under. */
const SELECTED_MODEL_KEY = 'omp_selected_model';

export function isScheduleKind(value: unknown): value is ScheduleKind {
  return typeof value === 'string' && SCHEDULE_KINDS.some((kind) => kind === value);
}

/** A trimmed string, or null when the value is absent/blank/not a string. */
export function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function optionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function parseModelField(body: Record<string, unknown>): ScheduledTaskModel | null {
  return normalizeModel(body.model);
}

/**
 * The model snapshot a new task runs with when the request carries none: the
 * composer's persisted selection plus the persisted access mode.
 *
 * Resolved server-side rather than sent by the modal, because the modal has no
 * model picker — a scheduled run happens with nobody watching, so the snapshot
 * has to exist, and the value the user last chose in the composer is the only
 * honest default. A `null` result is a real outcome: with no selection stored,
 * omp's own default model applies at dispatch.
 */
export async function resolveDefaultTaskModel(): Promise<ScheduledTaskModel | null> {
  try {
    const db = await getDb();
    const stored = await readSettingsJson<unknown>(db, SELECTED_MODEL_KEY, null);
    const ref = normalizeModel(stored);
    if (!ref) return null;
    return { ...ref, thinkingLevel: ref.thinkingLevel ?? 'auto', accessMode: await loadPersistedAccessMode() };
  } catch {
    return null;
  }
}

/**
 * The project directory a task should run in: the folder's `project_path` when
 * it has one, else the folder NAME (which is what the sidebar's own cwd
 * resolution falls back to). Null when no folder was chosen, which the runtime
 * turns into the server's cwd.
 */
export async function resolveTaskCwd(folderId: number | null): Promise<string | null> {
  if (folderId === null) return null;
  const db = await getDb();
  const row = (await db.get('SELECT project_path, name FROM workspace_folders WHERE id = ?', [folderId])) as
    | { project_path?: string | null; name?: string | null }
    | undefined;
  if (!row) return null;
  return row.project_path || row.name || null;
}

export function readTaskBody(body: unknown): {
  name: string;
  prompt: string;
  kind: ScheduleKind;
  spec: string;
  folderId: number | null;
  sessionId: string | null;
  model: ScheduledTaskModel | null;
  enabled: boolean;
} | null {
  if (!isRecord(body)) return null;
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) return null;
  if (!isScheduleKind(body.kind)) return null;
  if (typeof body.spec !== 'string' || !body.spec.trim()) return null;
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    prompt: body.prompt.trim(),
    kind: body.kind,
    spec: body.spec.trim(),
    folderId: optionalNumber(body.folderId),
    sessionId: optionalText(body.sessionId),
    model: parseModelField(body),
    enabled: body.enabled !== false,
  };
}
