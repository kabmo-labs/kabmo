/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Can this install transcribe locally right now?" — the answer's shape, shared
 * because the settings page renders it and the server produces it.
 *
 * The answer is a probe, not a version check: omp's STT worker changed transport
 * between 18.11 and 19.1, and a process that cannot answer a ping must be
 * reported as unavailable — with the reason — instead of letting the composer
 * fail with a bare `STT worker exited.`
 */

export interface LocalDictationCapability {
  available: boolean;
  /** Why it is unavailable, in words a user can act on. */
  reason?: string;
}

/** Narrow an unknown payload into the capability shape. */
export function parseLocalCapability(value: unknown): LocalDictationCapability {
  if (typeof value !== 'object' || value === null) return { available: false };
  if (!('available' in value) || value.available !== true) {
    return {
      available: false,
      ...('reason' in value && typeof value.reason === 'string' ? { reason: value.reason } : {}),
    };
  }
  return { available: true };
}
