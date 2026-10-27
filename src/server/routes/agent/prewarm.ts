import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { prewarmRpcSession } from '@/server/lib/omp/rpc/prewarm-pool';
import { isApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { rpcErrorResponse } from '@/server/lib/omp/rpc/errors';

// POST /api/agent/prewarm — start an idle `omp --mode rpc-ui` process for the
// given cwd ahead of the first prompt so adopting it on send skips the
// multi-second boot. Fired when the user opens a new (pending) session; the
// spawn call in /api/agent/new claims it via startNewRpcSession. Errors are
// non-fatal by design: a failed prewarm just means the next send spawns cold.
export async function action({ request }: ActionFunctionArgs) {
  try {
    const body = await request.json().catch(() => null);
    const cwd = typeof body?.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
    if (!cwd) {
      return json({ error: 'cwd is required', code: 'cwd_required' }, { status: 400 });
    }
    // Trust a client-supplied mode only when valid; else use the persisted pick.
    const accessMode = isApprovalMode(body?.accessMode) ? body.accessMode : await loadPersistedAccessMode();
    prewarmRpcSession(cwd, accessMode);
    return json({ success: true });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}
