/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/harness/update/status` — the background update the POST started.
 *
 * The POST answers `202` in milliseconds and the install keeps running in a
 * detached worker, so this is how the dialog learns where it is and whether it
 * finished. A poll is also where the SERVER applies the post-install side
 * effects (`finalizeUpdateJob`): the caches and the launch line live in this
 * process, not in the worker.
 *
 * `null` is a real answer — no update has ever run — and it must not be a 404:
 * the About card asks this on every open, and a "not found" would read as a
 * broken route rather than "nothing is running".
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import { finalizeUpdateJob } from '@/server/lib/harness/update-job.server';

export async function loader() {
  const job = await finalizeUpdateJob();
  return json({ job }, { headers: NO_STORE_HEADERS });
}
