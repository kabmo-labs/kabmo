/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `/api/schedule/:taskId/runs` — a task's run history, newest first.
 *
 * Read-only, and answered with no-store: the panel reads it when a task row is
 * expanded, and a cached body would show the run that just finished as still
 * running.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { requireParam } from '@/server/lib/route-adapter';
import { listScheduledTaskRuns } from '@/server/lib/schedule/store.server';

export async function loader({ params }: LoaderFunctionArgs) {
  const taskId = requireParam(params, 'taskId');
  if (!taskId) return json({ error: 'Task ID is required' }, { status: 400 });
  return json({ runs: await listScheduledTaskRuns(taskId) }, { headers: NO_STORE_HEADERS });
}
