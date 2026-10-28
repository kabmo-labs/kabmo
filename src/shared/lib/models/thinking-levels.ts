/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Thinking-level resolution for the CURRENT model in the composer. Faithful
 * port of omp-web/lib/thinking-levels.ts.
 *
 * `/api/models` carries each pickable model's baked effort ladder as
 * `["off", ...efforts]`. A running session's `get_state` resolves the model
 * omp is ACTUALLY using — which can differ from the session file's model
 * entry (a disabled/renamed provider falls back to the default model, and the
 * catalog only lists enabled providers). When the catalog misses the current
 * model, the live metadata is the authoritative fallback, so the dropdown
 * never falls back to the generic ladder and lists unsupported efforts.
 */

import type { ThinkingModelMeta } from '@/shared/types';

const DEFAULT_THINKING_LEVELS = ['auto', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Order the model's own ladder by the familiar sequence while preserving
 * provider-defined additions. Returns an EMPTY list when the model provides no
 * ladder — no generic fallback, no injected 'auto'. Callers must treat an empty
 * result as "this model exposes no thinking levels" and disable the selector.
 */
export function selectableThinkingLevels(available: readonly string[] | null | undefined): string[] {
  if (!available || available.length === 0) return [];

  const remaining = new Set(available.filter((level) => level && level !== 'auto'));
  const ordered = DEFAULT_THINKING_LEVELS.filter((level) => remaining.delete(level));
  return [...ordered, ...remaining];
}

/** "off" is always a valid selector; concrete efforts come from the model. */
export function thinkingLevelsForMeta(meta: ThinkingModelMeta): string[] {
  if (!meta.reasoning) return ['off'];
  return ['off', ...(meta.thinking?.efforts ?? [])];
}

/**
 * Normalize an omp `thinking_level_change` value for display: a concrete
 * level string passes through trimmed; null/undefined/empty collapse to
 * `off`. Callers only invoke this when a change record actually exists, so
 * "no record" (undefined return upstream) stays distinct from "off".
 */
export function normalizeThinkingLevel(level: unknown): string {
  return typeof level === 'string' && level.trim() ? level.trim() : 'off';
}

/**
 * Levels offered for the current model: the catalog's baked ladder wins; the
 * live session model backs non-catalog models. Returns null when neither
 * source knows the model — callers then fall back to the generic ladder.
 */
export function resolveAvailableThinkingLevels(
  catalogLevels: string[] | undefined,
  model: { provider: string; modelId: string } | null,
  liveModel: ThinkingModelMeta | null,
): string[] | null {
  if (catalogLevels && catalogLevels.length > 0) return catalogLevels;
  if (model && liveModel && liveModel.provider === model.provider && liveModel.modelId === model.modelId) {
    return thinkingLevelsForMeta(liveModel);
  }
  return null;
}
