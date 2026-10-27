/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recycle the omp processes that stand by for a chat nobody has started yet.
 *
 * Two pools hold a process with no session and no turn — the shared utility
 * children (`--no-session --no-lsp`, answering `get_available_models`,
 * `get_login_providers`, `get_available_commands`) and the per-cwd prewarm
 * entries (an idle session host waiting to be adopted by the next send). Both
 * are spawned ONCE and then live for minutes: the utility pool is idle-killed
 * after 5 minutes and a prewarm waits for a send that may be an hour away.
 *
 * That longevity is what makes a binary replacement invisible. `omp update`
 * swaps the launcher and the package on disk, but a child already running is
 * the old build for its whole life, so the provider list, the model list and
 * the composer's `/` popup keep answering from the previous version. The
 * per-session children are the same story with a longer fuse — a session can
 * sit idle for ten minutes before its own timer reclaims it.
 *
 * So a reload here means DISPOSE, not `/reload-plugins`: a fresh child is the
 * only thing that reads the new binary, and "no child" is a state both pools
 * already handle by design (lazy start). `/reload-plugins` re-reads skill and
 * plugin FILES inside a live process and would leave the old binary running —
 * see `reload.server.ts` for that, which is a different question.
 *
 * Every live SESSION is deliberately untouched: it may be mid-turn, and its
 * `--resume` on the next command already boots the current binary. The two
 * pools below are the ones whose staleness the user can see and cannot fix.
 *
 * Sources are injected so the policy is testable without patching modules —
 * see `standby.server.test.ts`.
 */

import { restartPrewarmedSessions } from '@/server/lib/omp/rpc/prewarm-pool';
import { restartUtilityProcesses } from '@/server/lib/omp/rpc/utility';
import { invalidateSkillCache } from '@/server/lib/omp/config/skills';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';
import { invalidateUsageCache } from '@/server/lib/usage/omp-usage.server';

/** What one recycle pass actually did. */
export interface StandbyRecycleReport {
  /** Utility children disposed (a fresh one boots on the next command). */
  utility: number;
  /** Unclaimed prewarmed processes disposed. */
  prewarmed: number;
}

export interface StandbyDeps {
  restartUtility: () => Promise<number>;
  restartPrewarmed: () => Promise<number>;
  /** Drop the caches that were built FROM a process or from the omp binary. */
  invalidateCaches: () => void;
}

export interface StandbyRecycler {
  recycle: () => Promise<StandbyRecycleReport>;
}

/**
 * Caches that outlive the process they describe. The utility pool is the
 * expensive one — `get_available_models` costs a registry spawn — but a cached
 * provider list served after the recycle would make the recycle look like it
 * did nothing, which is exactly the bug this module exists to fix. The usage
 * snapshot and the omp binary path are cached for the same reason: both were
 * produced by the build that is no longer installed.
 */
function invalidateProcessDerivedCaches(): void {
  invalidateModelsCaches();
  invalidateSkillCache();
  invalidateUsageCache();
  invalidateOmpCliCache();
}

export function createStandbyRecycler(deps: StandbyDeps): StandbyRecycler {
  /** In-flight pass, so a burst of triggers (an update plus a button click)
   *  coalesces onto one recycle instead of racing two through the same pools. */
  let inFlight: Promise<StandbyRecycleReport> | null = null;

  async function pass(): Promise<StandbyRecycleReport> {
    // Both pools are independent, and a failure in one must not skip the other:
    // a pool that refuses to dispose is still better reported than silently
    // leaving the other stale.
    const [utility, prewarmed] = await Promise.all([
      deps.restartUtility().catch((error) => {
        console.error(`Failed to recycle utility omp processes: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      }),
      deps.restartPrewarmed().catch((error) => {
        console.error(`Failed to recycle prewarmed omp processes: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      }),
    ]);
    deps.invalidateCaches();
    return { utility, prewarmed };
  }

  function recycle(): Promise<StandbyRecycleReport> {
    if (inFlight) return inFlight;
    inFlight = pass().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { recycle };
}

const serverRecycler = createStandbyRecycler({
  restartUtility: restartUtilityProcesses,
  restartPrewarmed: restartPrewarmedSessions,
  invalidateCaches: invalidateProcessDerivedCaches,
});

/** Dispose every standby omp process so the next command boots the current
 *  binary, and drop the caches that were built from the previous one. */
export function recycleStandbyProcesses(): Promise<StandbyRecycleReport> {
  return serverRecycler.recycle();
}
