/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The live telemetry omp reports on a RUNNING task row.
 *
 * omp 18.13.0 copies `stage`, `requests`, `cost`, `contextTokens` and
 * `contextWindow` out of a subagent task's progress record into the job
 * snapshot behind `wait` and `read proc://`, which is what lets omp's own card
 * read `5h7m · 90 req · $18.40 · ctx 160K/1M · stage: implementing`. The values
 * exist only while the job runs — omp omits them from a settled row — so a
 * finished row keeps its plain shape.
 *
 * Stated once because the wait card and the proc card read the SAME snapshot,
 * and a per-surface formatter is how one of them ends up printing
 * `ctx 163840` beside the other's `ctx 160K`.
 *
 * The FIELDS and their order are omp's; the token rounding is Kabmo's own
 * (`formatCompactTokens`, one decimal above 1000: `163.8K`, `1.0M`) rather than
 * omp's rounded `164K`/`1M`, because every other token label in this console —
 * the context ring, the usage bars — reads that way, and a job row that
 * disagreed with the ring beside it would look like a second measurement.
 */

import { formatCompactTokens } from '@/shared/lib/format/number';

/** The progress fields omp reports on a task job. */
export interface JobProgressFields {
  status?: string;
  requests?: number;
  cost?: number;
  contextTokens?: number;
  contextWindow?: number;
  completionPercent?: number;
  stage?: string;
}

export interface JobProgressOptions {
  /** Draw the subagent's self-estimated percent; off where the row already shows it. */
  includePercent?: boolean;
}

/** `$18.40`, or `<$0.01` below half a cent — the same cutoff omp's own row uses. */
function costLabel(cost: number): string | undefined {
  if (!Number.isFinite(cost) || cost <= 0) return undefined;
  return cost < 0.005 ? '<$0.01' : `$${cost.toFixed(2)}`;
}

/**
 * The progress pieces for one job, in omp's order: requests, cost, context
 * fill, estimated percent, stage.
 *
 * Gated on `status === 'running'` for the same reason omp gates its own
 * suffix: a stored snapshot must never paint a live counter over a row that has
 * already finished.
 */
export function jobProgressParts(job: JobProgressFields, options: JobProgressOptions = {}): string[] {
  if (job.status !== 'running') return [];
  const parts: string[] = [];
  if (job.requests !== undefined && job.requests > 0) parts.push(`${job.requests} req`);
  if (job.cost !== undefined) {
    const cost = costLabel(job.cost);
    if (cost) parts.push(cost);
  }
  const tokens = formatCompactTokens(job.contextTokens);
  if (tokens) {
    const window = formatCompactTokens(job.contextWindow);
    parts.push(window ? `ctx ${tokens}/${window}` : `ctx ${tokens}`);
  }
  if (options.includePercent && job.completionPercent !== undefined) {
    parts.push(`~${Math.round(job.completionPercent)}%`);
  }
  const stage = job.stage?.replace(/\s+/g, ' ').trim();
  if (stage) parts.push(`stage: ${stage}`);
  return parts;
}

/** The progress line for a job row, or undefined when it has nothing to say. */
export function jobProgressLine(job: JobProgressFields, options: JobProgressOptions = {}): string | undefined {
  const parts = jobProgressParts(job, options);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
