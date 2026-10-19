/**
 * Orchestrates the "Check for updates" flow: Kabmo and oh-my-pi (`omp`).
 * Both probes read npm — the registry each install comes from — and run
 * concurrently, and neither is allowed to reject, so the endpoint always returns
 * a complete UpdateCheckResult.
 *
 * MOCK mode answers a fixed pair that says an update is available. The real
 * probe reads the version installed on THIS machine, which on a development
 * checkout is usually the newest published one — so the demo would never show
 * the update UI it exists to exercise, and the popup's own gate would never open.
 */

import { isMockMode } from '@/server/mock.server';
import { resolveKabmoVersion } from '@/server/lib/updates/install';
import { releaseTagUrl } from '@/server/lib/updates/release-url';
import { checkOmpUpdate } from '@/server/lib/updates/omp';
import type { UpdateCheckResult, UpdateTargetInfo } from '@/shared/types/updates';

/** The demo range's endpoints; `buildUpdateChangelog` serves the matching notes. */
export const MOCK_CURRENT_VERSION = '3.6.0';
export const MOCK_LATEST_VERSION = '3.8.0';

function mockTargets(): UpdateCheckResult {
  return {
    kabmo: {
      current: MOCK_CURRENT_VERSION,
      latest: MOCK_LATEST_VERSION,
      updateAvailable: true,
      installed: true,
      error: null,
      releaseName: `v${MOCK_LATEST_VERSION}`,
      releaseUrl: releaseTagUrl(MOCK_LATEST_VERSION),
    },
    omp: { current: '18.3.0', latest: '18.4.0', updateAvailable: true, installed: true, error: null },
    checkedAt: new Date().toISOString(),
  };
}

async function checkKabmo(): Promise<UpdateTargetInfo> {
  try {
    // Reads the version on disk, so a completed update stops showing as
    // available even before the server is restarted.
    const info = await resolveKabmoVersion();
    return {
      current: info.current,
      latest: info.latest,
      updateAvailable: info.updateAvailable,
      installed: true,
      error: info.error,
      releaseName: info.latest ? `v${info.latest}` : null,
      releaseUrl: info.latest ? releaseTagUrl(info.latest) : null,
    };
  } catch (err) {
    return {
      current: null,
      latest: null,
      updateAvailable: false,
      installed: true,
      error: err instanceof Error ? err.message : 'Failed to check Kabmo updates',
      releaseName: null,
      releaseUrl: null,
    };
  }
}

export async function checkAllUpdates(): Promise<UpdateCheckResult> {
  if (isMockMode()) return mockTargets();

  const [kabmo, omp] = await Promise.all([checkKabmo(), checkOmpUpdate()]);
  return { kabmo, omp, checkedAt: new Date().toISOString() };
}
