import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { prewarmRpcSession } from '@/server/lib/omp/rpc/prewarm-pool';
import { prewarmAcpSession } from '@/server/lib/harness/acp/prewarm.server';
import { commandAvailable } from '@/server/lib/harness/auto-probe.server';
import { loadHarnessConfig } from '@/server/lib/harness/config.server';
import { kabmoModeEnv } from '@/server/lib/omp/extensions/locator';
import { parseModeSelection } from '@/server/lib/omp/mode/request';
import { isApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { rpcErrorResponse } from '@/server/lib/omp/rpc/errors';
import { isMockMode } from '@/server/mock.server';
import { HARNESS_IDS, harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';

/** A JSON object, or `{}` for anything else — same read as the spawn route. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// POST /api/agent/prewarm — start an idle agent for the given cwd ahead of the
// first prompt so adopting it on send skips the boot. Fired when the user opens
// a new (pending) session and whenever the composer's harness pick moves; the
// spawn call in /api/agent/new claims it. Errors are non-fatal by design: a
// failed prewarm just means the next send spawns cold.
//
// `harness` selects the POOL: omp's RPC child (`omp --mode rpc-ui`) or an ACP
// agent's own process. Before this, only the RPC pool existed, so a pending chat
// on any ACP harness paid the full agent boot on its first prompt.
export async function action({ request }: ActionFunctionArgs) {
  try {
    const body = await request.json().catch(() => null);
    const cwd = typeof body?.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
    if (!cwd) {
      return json({ error: 'cwd is required', code: 'cwd_required' }, { status: 400 });
    }
    // Trust a client-supplied mode only when valid; else use the persisted pick.
    const accessMode = isApprovalMode(body?.accessMode) ? body.accessMode : await loadPersistedAccessMode();
    const harness: HarnessId = HARNESS_IDS.includes(body?.harness as HarnessId)
      ? body.harness as HarnessId
      : 'omp-rpc';
    // MOCK mode runs no agent BY DESIGN: spawning one here would either fail on
    // every pending chat or start a real agent for a demo shell.
    if (isMockMode()) return json({ success: true, harness, isMock: true });

    if (harness !== 'omp-rpc' && !harnessDescriptor(harness)?.builtIn) {
      // A harness whose binary is not installed has nothing to warm, and its
      // spawn would fail on every key press of the pending chat. The picker
      // already paints it as blocked; this keeps the pool from trying.
      const config = await loadHarnessConfig(harness);
      if (!commandAvailable(harness, config)) return json({ success: true, harness, unavailable: true });
      // The ACP picks are config writes at claim time, so the entries carry no
      // selection to match: every warm agent for this harness+cwd can serve it.
      prewarmAcpSession(harness, cwd);
      return json({ success: true, harness });
    }

    // The omp child reads its selection from the START-TIME environment, so the
    // prewarm carries the pending chat's Plan/Goal pick: a child warmed without
    // it can never serve that chat and would be killed at the send.
    const modeEnv = body?.modes !== undefined
      ? kabmoModeEnv(parseModeSelection(asRecord(body.modes)))
      : undefined;
    prewarmRpcSession(cwd, accessMode, modeEnv);
    return json({ success: true, harness: 'omp-rpc' });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}
