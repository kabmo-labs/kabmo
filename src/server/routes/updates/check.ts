import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import { checkAllUpdates } from '@/server/lib/updates/check';
import type { UpdateCheckResult, UpdateTargetInfo } from '@/shared/types/updates';

function failureResult(message: string): UpdateCheckResult {
  const target = (): UpdateTargetInfo => ({
    current: null,
    latest: null,
    updateAvailable: false,
    installed: false,
    error: message,
  });
  return { kabmo: target(), omp: target(), checkedAt: new Date().toISOString() };
}

/**
 * GET /api/updates/check — latest Kabmo release + oh-my-pi status.
 * Always returns a valid UpdateCheckResult so the client never sees a 500.
 */
export async function loader() {
  try {
    return json(await checkAllUpdates(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check for updates';
    return json(failureResult(message), { headers: NO_STORE_HEADERS });
  }
}
