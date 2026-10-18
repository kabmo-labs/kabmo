/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * POST /api/omp/reload-engine — dispose every standby omp process and drop the
 * caches built from the previous binary.
 *
 * The settings sidebar's "Reload OMP" button used to be a 1200 ms
 * spinner with no request behind it. A reload has to mean something, and the
 * only processes the chamber may bounce without destroying work are the ones
 * with no session and no turn: the pooled utility children that answer the
 * provider/model lists and the composer's `/` popup, plus the prewarmed session
 * hosts waiting for a first prompt. Live sessions are left alone — see
 * `standby.server.ts`.
 *
 * The same pass runs automatically after a successful `omp update`, because
 * that is the moment the staleness appears and the user has no other way to
 * notice it.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { recycleStandbyProcesses } from '@/server/lib/omp/session/standby.server';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  if (isMockMode()) return json({ success: true, utility: 0, prewarmed: 0, isMock: true });

  try {
    const { utility, prewarmed } = await recycleStandbyProcesses();
    return json({ success: true, utility, prewarmed });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
