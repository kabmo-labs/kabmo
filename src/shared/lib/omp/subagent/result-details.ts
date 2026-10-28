/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Small lenient guards + task SingleResult projections shared by subagent
 * history extraction. Kept out of `history.ts` so the roster fold stays the
 * only concern of that module (and under the file-size ceiling).
 */

import { isRecord } from '@/shared/lib/util/guards';
import type { SubagentAgentSource, SubagentHistoryResult } from '@/shared/types/omp/subagent';

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asAgentSource(value: unknown): SubagentAgentSource | undefined {
  return value === 'bundled' || value === 'user' || value === 'project' ? value : undefined;
}

/** Settled cost rides `usage.cost` on a task SingleResult; top-level `cost` is
 *  absent there, so both shapes feed the same projection. */
export function taskResultUsageCost(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const cost = isRecord(usage.cost) ? usage.cost : undefined;
  if (!cost) return undefined;
  const total = asNumber(cost.total);
  if (total !== undefined) return total;
  const input = asNumber(cost.input);
  const output = asNumber(cost.output);
  if (input !== undefined && output !== undefined) return input + output;
  return undefined;
}

/** Project `structuredOutput` to its documented UI fields only — `data` is
 *  arbitrary upstream payload and must never ride the roster response. */
export function taskResultStructuredOutput(
  value: unknown,
): NonNullable<SubagentHistoryResult['structuredOutput']> | undefined {
  if (!isRecord(value)) return undefined;
  const out: NonNullable<SubagentHistoryResult['structuredOutput']> = {};
  for (const key of ['source', 'mode', 'status', 'error'] as const) {
    const text = asString(value[key]);
    if (text !== undefined) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
