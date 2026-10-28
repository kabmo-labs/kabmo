/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `/api/schedule` — the scheduled-task collection.
 *
 * GET    → every task, newest schedule first.
 * POST   → create one; the schedule is validated here so a bad spec can never
 *          reach the row.
 * PATCH  → edit one (`?id=`), including pause/resume through `enabled`.
 * DELETE → remove one (`?id=`), with its run history.
 *
 * The runtime is NOT the only writer of `next_run_at`: a create, a schedule
 * edit and a resume each compute their own first fire, so a task edited in the
 * UI is due from the moment it was saved rather than from whatever the old
 * schedule had left over.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { runScheduledTask } from '@/server/lib/schedule/runtime.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
  type ScheduledTaskPatch,
} from '@/server/lib/schedule/store.server';
import {
  isScheduleKind,
  optionalText,
  parseModelField,
  readTaskBody,
  resolveDefaultTaskModel,
  resolveTaskCwd,
} from '@/server/routes/schedule/body';

export async function loader(_args: LoaderFunctionArgs) {
  return json({ tasks: await listScheduledTasks() }, { headers: NO_STORE_HEADERS });
}

/** POST — create a task. */
async function createTask({ request }: ActionFunctionArgs) {
  const body = readTaskBody(await request.json().catch(() => null));
  if (!body) {
    return json(
      { error: 'Expected { prompt, kind: once|every|cron, spec } with a non-empty prompt and spec.' },
      { status: 400 },
    );
  }
  try {
    const task = await createScheduledTask({
      name: body.name,
      prompt: body.prompt,
      kind: body.kind,
      spec: body.spec,
      folderId: body.folderId,
      cwd: await resolveTaskCwd(body.folderId),
      sessionId: body.sessionId,
      model: body.model ?? (await resolveDefaultTaskModel()),
    });
    emitRealtimeSignal('schedule-changed');
    return json({ task, tasks: await listScheduledTasks() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

/** PATCH — edit one task; a schedule or `enabled` change resets its clock. */
async function patchTask({ request }: ActionFunctionArgs) {
  const id = optionalText(new URL(request.url).searchParams.get('id'));
  if (!id) return json({ error: 'id is required' }, { status: 400 });
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return json({ error: 'Expected a JSON body' }, { status: 400 });

  const patch: ScheduledTaskPatch = {};
  if (typeof raw.name === 'string') patch.name = raw.name.trim();
  if (typeof raw.prompt === 'string') {
    if (!raw.prompt.trim()) return json({ error: 'prompt cannot be empty' }, { status: 400 });
    patch.prompt = raw.prompt.trim();
  }
  if (raw.kind !== undefined) {
    if (!isScheduleKind(raw.kind)) return json({ error: 'kind must be once, every or cron' }, { status: 400 });
    patch.kind = raw.kind;
  }
  if (raw.spec !== undefined) {
    if (typeof raw.spec !== 'string' || !raw.spec.trim()) {
      return json({ error: 'spec cannot be empty' }, { status: 400 });
    }
    patch.spec = raw.spec.trim();
  }
  if (raw.folderId !== undefined) {
    patch.folderId = typeof raw.folderId === 'number' ? raw.folderId : null;
    patch.cwd = await resolveTaskCwd(patch.folderId);
  }
  if (raw.sessionId !== undefined) patch.sessionId = optionalText(raw.sessionId);
  if (raw.model !== undefined) patch.model = parseModelField(raw);
  if (raw.enabled !== undefined) patch.enabled = raw.enabled !== false;

  try {
    const task = await updateScheduledTask(id, patch);
    if (task) emitRealtimeSignal('schedule-changed');
    if (!task) return json({ error: 'Task not found' }, { status: 404 });
    return json({ task, tasks: await listScheduledTasks() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

/** DELETE — remove one task and its run history. */
async function removeTask({ request }: ActionFunctionArgs) {
  const id = optionalText(new URL(request.url).searchParams.get('id'));
  if (!id) return json({ error: 'id is required' }, { status: 400 });
  const removed = await deleteScheduledTask(id);
  if (removed) emitRealtimeSignal('schedule-changed');
  if (!removed) return json({ error: 'Task not found' }, { status: 404 });
  return json({ tasks: await listScheduledTasks() });
}

/**
 * POST `?id=…&run=now` — fire a task immediately, without touching its clock.
 *
 * Deliberately not routed through the claim: a manual run is the user asking
 * "does this work", and moving `next_run_at` would silently skip the scheduled
 * fire they were testing. The run is still recorded, flagged so it does not
 * inflate the task's fire count.
 */
async function runNow({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const id = optionalText(url.searchParams.get('id'));
  if (!id) return json({ error: 'id is required' }, { status: 400 });
  const task = await getScheduledTask(id);
  if (!task) return json({ error: 'Task not found' }, { status: 404 });
  if (!task.prompt.trim()) return json({ error: 'This task has no prompt to run' }, { status: 400 });
  const sessionId = await runScheduledTask(task, { manual: true });
  const updated = await getScheduledTask(id);
  if (!sessionId) {
    return json({ error: updated?.lastError ?? 'The run failed', task: updated }, { status: 502 });
  }
  return json({ task: updated, sessionId });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const run = new URL(request.url).searchParams.get('run');
  if (request.method === 'POST' && run === 'now') return runNow({ request, params });
  if (request.method === 'POST') return createTask({ request, params });
  if (request.method === 'PATCH' || request.method === 'PUT') return patchTask({ request, params });
  if (request.method === 'DELETE') return removeTask({ request, params });
  return methodNotAllowed({ request, params });
}
