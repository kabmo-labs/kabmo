/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Narrowing a harness-update record that came from somewhere else.
 *
 * Two readers get one over the wire or off disk — the About card, which parses
 * the status response, and the server, which parses the file a detached worker
 * wrote — and neither may assume the shape: a half-written file or an older
 * build's payload would otherwise reach `job.steps.find(...)` and throw inside a
 * render. The guard IS the check, so a payload that fails it reads as "no run".
 */

import type { HarnessUpdateJob } from '@/shared/types/harness-update';

export function isHarnessUpdateJob(value: unknown): value is HarnessUpdateJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<HarnessUpdateJob>;
  return typeof job.harness === 'string'
    && typeof job.label === 'string'
    && typeof job.startedAt === 'number'
    && Array.isArray(job.steps)
    && (job.finishedAt === null || typeof job.finishedAt === 'number');
}

/** The `job` field of a status payload, or null when it is not a record. */
export function updateJobFrom(payload: unknown): HarnessUpdateJob | null {
  if (!payload || typeof payload !== 'object') return null;
  const found: unknown = (payload as { job?: unknown }).job;
  return isHarnessUpdateJob(found) ? found : null;
}
