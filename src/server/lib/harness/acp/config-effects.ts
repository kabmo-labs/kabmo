/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two outside effects an ACP config answer needs, wired where the database
 * and the live run row live.
 *
 * `@kabmo-labs/kabmo-acp-session-config` owns the pure rules — which selector a
 * reply rewrites, when a model change is announced — and takes these as
 * arguments so the package itself never imports `db.server` or the stream-state
 * store. A caller that forgot to pass them would silently drop a persisted
 * grant, so there is exactly ONE value here and every ACP caller uses it.
 */

import { saveAcpGrant } from '@/server/lib/harness/acp/grants.server';
import { markStreamModel } from '@/shared/lib/omp/session/stream-state.server';
import type { AcpConfigEffects } from '@kabmo-labs/kabmo-acp-session-config/session-config';

export const ACP_CONFIG_EFFECTS: AcpConfigEffects = {
  saveGrant: saveAcpGrant,
  markStreamModel,
};
