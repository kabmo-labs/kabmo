/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/harness/update/status` — every harness's background update record —
 * and `DELETE` on the same path, which dismisses one settled result.
 *
 * The POST answers in milliseconds and the install keeps running in a detached
 * worker, so this is how the dialog learns where each run is and whether it
 * finished. One record per harness, because two presses are a queue: a run
 * installing and a run waiting its turn are two different rows.
 *
 * A poll is also where the SERVER acts on the records: it applies the
 * post-install side effects (`forgetProbe`, the launch-line repoint), settles a
 * run that died without reporting, and starts the next waiting one. The ticker
 * in `update-queue.server.ts` does the same without a browser, so this route is
 * a read with the same pass in front of it — never the only thing keeping the
 * queue moving.
 *
 * An empty array is a real answer — no update has ever run — and it must not be
 * a 404: the About card asks this on every open, and a "not found" would read as
 * a broken route rather than "nothing is running".
 *
 * **A settled record is history, and history can be dismissed.** The row used to
 * keep "claude updated (adapter) — it now reports 0.106.0" forever, because the
 * record had no way out: a dismissal has to delete it (or the next open reads it
 * back) and must refuse while the run is still moving — deleting a live record
 * would hide the spinner and let a second install start.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { getHarnessUpdateStatusPath } from '@/server/lib/lifecycle/paths';
import { pumpUpdateQueue, serializeUpdateWork } from '@/server/lib/harness/update-queue.server';
import { readUpdateJob, removeUpdateJob } from '@/server/lib/harness/update-job-store';
import { isBuiltinHarness } from '@/shared/lib/harness/catalog';
import { jobUnfinished } from '@/shared/lib/harness/update-job';

export async function loader() {
  const jobs = await pumpUpdateQueue();
  return json({ jobs }, { headers: NO_STORE_HEADERS });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') return methodNotAllowed({ request, params });

  const parsed = await parseJsonBody<{ harness?: unknown }>(request);
  if (!parsed.ok) return json({ error: 'Request body is not valid JSON' }, { status: 400 });
  const id = parsed.body?.harness;
  if (typeof id !== 'string' || !isBuiltinHarness(id)) {
    return json({ error: 'Unknown harness' }, { status: 400 });
  }

  // Serialized with the queue's own reads/writes: the post-install probe writes
  // the record after answering, so a delete between its read and its write would
  // otherwise be undone and the dismissed message would come back.
  return serializeUpdateWork(async () => {
    const path = getHarnessUpdateStatusPath(id);
    const job = await readUpdateJob(path);
    if (job && jobUnfinished(job)) {
      return json({
        error: `${job.label} update is still ${job.queuedAt !== null ? 'queued' : 'running'} — nothing to dismiss yet`,
      }, { status: 409, headers: NO_STORE_HEADERS });
    }
    await removeUpdateJob(path);
    return json({ dismissed: true }, { headers: NO_STORE_HEADERS });
  });
}
