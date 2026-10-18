/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * POST /api/chamber/restart — stop this instance and serve it again.
 *
 * The settings sidebar's "Restart OMPChamber" button. It is the same operation
 * `ompchamber restart --port <port>` performs, armed as a detached child once
 * the response has left (`RESTART_GRACE_MS`), because a process cannot replace
 * itself while it still holds the port. The console then waits for a process
 * with a different identity to answer `/api/health` and reloads into it — the
 * same contract `POST /api/updates/apply` uses, so a restart reached from
 * either surface behaves identically.
 *
 * An instance the CLI did not start is REFUSED, with the reason in `message`:
 * `bun run dev` is a supervisor the chamber does not own, and signalling it
 * would end the user's dev loop rather than restart it.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { scheduleSelfRestart } from '@/server/lib/lifecycle/restart';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  // A restart ends a process. In demo mode the chamber is showing presets over
  // whatever the developer is running, and pressing a button in a demo must
  // not take a server down, so the refusal is stated rather than simulated.
  if (isMockMode()) {
    return json({
      success: true,
      restarting: false,
      isMock: true,
      message: 'Restart is unavailable in mock mode.',
    });
  }

  const plan = scheduleSelfRestart('restart');
  return json({ success: true, restarting: plan.restarting, message: plan.message });
}
