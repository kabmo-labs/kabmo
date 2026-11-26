import { json } from '@kabmo-labs/kabmo-http';
import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import { runUtilityCommand } from '@kabmo-labs/kabmo-omp/rpc-process/utility';

/**
 * Live agent snapshot from the shared omp utility RPC process (get_state):
 * model, thinkingLevel, queue modes, fast mode, contextUsage, tokensPerSecond.
 * Read-only; no session required — this mirrors the omp CLI's default state.
 */
export async function loader({ request: _request }: LoaderFunctionArgs) {
  const mock = isMockMode();
  if (mock) {
    return json({ running: false, state: null, isMock: true });
  }
  try {
    const state = await runUtilityCommand<Record<string, unknown>>({ type: 'get_state' }, 30_000);
    return json({ running: true, state, isMock: false });
  } catch (error: any) {
    return json({ running: false, state: null, isMock: false, error: error.message }, { status: 200 });
  }
}
