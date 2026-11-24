/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Can this install transcribe locally right now?"
 *
 * The answer is a probe, not a version check: omp's STT worker changed transport
 * between 18.11 and 19.1 and this build's client no longer speaks it, so a
 * process that cannot answer a ping must be reported as unavailable — with the
 * reason — instead of letting the composer fail with a bare `STT worker exited.`
 *
 * Cached for a minute per process, like the omp config read it sits beside: the
 * probe spawns a child, and a settings page that re-renders must not spawn one
 * per render. A write to the engine selection drops the cache.
 */

import { sttWorker } from '@/server/lib/dictation/omp-stt-worker';
import { isMockMode } from '@/server/mock.server';
import { LOCAL_DICTATION_UNAVAILABLE } from '@/shared/lib/dictation/engines';
import type { LocalDictationCapability } from '@/shared/lib/dictation/capability';

const CACHE_TTL_MS = 60_000;
const cacheKey = '__kabmoDictationCapability';

interface CacheHost {
  [cacheKey]?: { at: number; value: LocalDictationCapability } | null;
}

export function invalidateLocalDictationCapability(): void {
  (globalThis as CacheHost)[cacheKey] = null;
}

export async function localDictationCapability(force = false): Promise<LocalDictationCapability> {
  if (isMockMode()) {
    return { available: false, reason: 'Mock mode has no local speech-to-text worker.' };
  }

  const host = globalThis as CacheHost;
  const cached = host[cacheKey];
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const probe = await sttWorker().probe();
  const value: LocalDictationCapability = probe.ok
    ? { available: true }
    : {
        available: false,
        // The probe's sentence names the cause (a worker that never answered is
        // usually a Kabmo/omp version mismatch); the hint names the way out.
        reason: probe.error
          ? `${probe.error} Or pick an external engine in Settings → Dictation.`
          : LOCAL_DICTATION_UNAVAILABLE,
      };
  host[cacheKey] = { at: Date.now(), value };
  return value;
}
