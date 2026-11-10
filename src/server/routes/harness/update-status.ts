/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/harness/update/status` — every harness's background update record.
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
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import { pumpUpdateQueue } from '@/server/lib/harness/update-queue.server';

export async function loader() {
  const jobs = await pumpUpdateQueue();
  return json({ jobs }, { headers: NO_STORE_HEADERS });
}
