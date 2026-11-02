/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The default model a workspace folder can carry for its new chats.
 *
 * Stored as the COMPOSITE `provider:modelId` identity, the same one
 * `modelKey` uses, because a model id alone is not unique — the omp registry
 * serves the same id from several providers, and a value keyed on the id alone
 * would silently mean "whichever provider came first".
 *
 * `Not selected` is the historical default written by the schema, and legacy
 * rows also hold bare display names from the retired hardcoded list. Neither
 * resolves to a model, so they read as "inherit Kabmo's default" rather than as
 * a model nobody can start a chat on.
 */

import type { SelectedModel } from '@/shared/types';

/** The stored spelling of "no project default". */
export const NO_PROJECT_MODEL = 'Not selected';

/**
 * Read a stored project-model value. Anything that is not a non-empty
 * `provider:modelId` pair — including the legacy display names — yields null.
 */
export function parseProjectModel(value: unknown): SelectedModel | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === NO_PROJECT_MODEL) return null;

  const separator = trimmed.indexOf(':');
  if (separator <= 0 || separator === trimmed.length - 1) return null;

  const provider = trimmed.slice(0, separator).trim();
  const modelId = trimmed.slice(separator + 1).trim();
  if (!provider || !modelId) return null;

  return { provider, modelId };
}

/** The stored spelling of a picked model. */
export function projectModelValue(model: { provider: string; modelId: string }): string {
  return `${model.provider}:${model.modelId}`;
}

/**
 * The label a stored value gets in a picker: the live catalog's display name
 * when the catalog still serves it, else the raw stored string so a stale pick
 * is visible instead of looking like "inherit".
 */
export function projectModelLabel(
  value: string,
  entries: readonly { id: string; name: string; provider: string }[],
): string | null {
  const parsed = parseProjectModel(value);
  if (!parsed) return null;
  const match = entries.find(
    (entry) => entry.id === parsed.modelId && entry.provider === parsed.provider,
  );
  return match ? `${match.provider} · ${match.name || match.id}` : `${parsed.provider} · ${parsed.modelId}`;
}
