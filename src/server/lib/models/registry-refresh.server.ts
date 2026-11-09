/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Refresh every reader of a registry file AFTER a write to it.
 *
 * A `models.yml` write is invisible to the pooled `omp` utility child: the child
 * loads the file when it is SPAWNED, and `get_available_models` only awaits an
 * in-flight background refresh — it does not compare the file's mtime. So
 * dropping Kabmo's cache alone left `/api/models` re-reading the OLD registry
 * from that child, which is why adding a provider only showed up after omp was
 * restarted. Recycling the pool makes the next read start from the current file.
 *
 * The harness probes have the same problem from the other side: an ACP transport
 * reads the same file at spawn, so a probe recorded before the write describes a
 * registry that no longer exists. Those records are dropped, and the launchable
 * transports are re-probed when `reprobe` is set, so a picker that reads the
 * cache sees the new provider without an extra "check status" round.
 *
 * The caches are dropped LAST: the `models` topic resolver reads through
 * `loadModelsWithCache`, and publishing before the pool was recycled would cache
 * the pre-write answer for another 60s.
 */

import type { HarnessId } from '@/shared/lib/harness/catalog';
import { restartUtilityProcesses } from '@/server/lib/omp/rpc/utility';
import { getModelsConfigPath } from '@/server/lib/omp/config/models-config';
import { forgetProbe } from '@/server/lib/harness/probe-cache.server';
import { runAutoProbe } from '@/server/lib/harness/auto-probe.server';
import { harnessesSharingRegistry } from '@/server/lib/harness/provider-sources.server';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';

export interface RegistryWriteRefreshOptions {
  /**
   * The registry file that was written. Defaults to the omp `models.yml` path,
   * which is what every settings route writes.
   */
  path?: string;
  /** Workspace scope for a re-probe; defaults to the server's cwd. */
  cwd?: string;
  /**
   * Drop stored probes for the harnesses that read this file. Set false for a
   * write that cannot change what an agent lists (a per-model override), where
   * dropping the answer would only hide a still-valid model list.
   */
  probes?: boolean;
  /** Re-probe the launchable harnesses after dropping their records. */
  reprobe?: boolean;
}

/** The side effects the refresh drives, injected so a test can watch the ORDER. */
export interface RegistryRefreshDeps {
  restartUtilities: () => Promise<unknown>;
  registryPath: () => Promise<string>;
  sharing: (path: string) => HarnessId[];
  forget: (id: HarnessId) => Promise<void>;
  reprobe: (ids: readonly HarnessId[], cwd: string) => Promise<unknown>;
  invalidate: () => void;
}

const defaults: RegistryRefreshDeps = {
  restartUtilities: restartUtilityProcesses,
  registryPath: getModelsConfigPath,
  sharing: harnessesSharingRegistry,
  forget: forgetProbe,
  reprobe: (ids, cwd) => runAutoProbe({ ids, cwd }),
  invalidate: invalidateModelsCaches,
};

/**
 * Recycle the pooled omp readers, forget the probes that measured the old file,
 * and republish the model catalog once the fresh state is in place.
 *
 * Returns the harness ids that read the written file, so a caller can tell the
 * browser which tabs need their own probe.
 */
export async function refreshModelRegistryAfterWrite(
  options: RegistryWriteRefreshOptions = {},
  deps: RegistryRefreshDeps = defaults,
): Promise<HarnessId[]> {
  await deps.restartUtilities();

  const sharing = options.probes === false
    ? []
    : deps.sharing(options.path ?? (await deps.registryPath()));

  if (options.probes !== false) {
    for (const id of sharing) await deps.forget(id);
    if (options.reprobe) {
      await deps.reprobe(sharing, options.cwd ?? process.cwd());
    }
  }

  deps.invalidate();
  return sharing;
}
